#include <iostream>
#include <vector>
#include <array>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <atomic>
#include <utility>
#include <omp.h>

constexpr int GRID = 10;
constexpr int CELLS = GRID * GRID;
const std::vector<int> FLEET = {5, 4, 3, 3, 2};

using Mask = unsigned __int128;

std::vector<Mask> generate_placements(int size) {
    std::vector<Mask> masks;

    for (int r = 0; r < GRID; r++) {
        for (int c = 0; c <= GRID - size; c++) {
            Mask m = 0;
            for (int k = 0; k < size; k++) {
                int bit = r * GRID + c + k;
                m |= (Mask)1 << bit;
            }
            masks.push_back(m);
        }
    }

    for (int r = 0; r <= GRID - size; r++) {
        for (int c = 0; c < GRID; c++) {
            Mask m = 0;
            for (int k = 0; k < size; k++) {
                int bit = (r + k) * GRID + c;
                m |= (Mask)1 << bit;
            }
            masks.push_back(m);
        }
    }

    return masks;
}

void enumerate(
    Mask occupied,
    size_t ship_idx,
    const std::vector<std::vector<Mask>>& placements,
    unsigned long long local_hits[CELLS],
    unsigned long long& count
) {
    if (ship_idx == placements.size()) {
        count++;

        for (int bit = 0; bit < CELLS; bit++) {
            if (occupied & ((Mask)1 << bit)) {
                local_hits[bit]++;
            }
        }
        return;
    }

    for (Mask pm : placements[ship_idx]) {
        if (!(pm & occupied)) {
            enumerate(occupied | pm, ship_idx + 1, placements, local_hits, count);
        }
    }
}

int main() {
    std::vector<int> sorted_fleet = FLEET;
    std::sort(sorted_fleet.begin(), sorted_fleet.end(), std::greater<>());

    std::array<std::vector<Mask>, 6> cache{};
    for (int sz : sorted_fleet) {
        if (cache[sz].empty()) {
            cache[sz] = generate_placements(sz);
        }
    }

    std::vector<std::vector<Mask>> fleet_placements;
    fleet_placements.reserve(sorted_fleet.size());
    for (int sz : sorted_fleet) {
        fleet_placements.push_back(cache[sz]);
    }

    // build 16800 carrier+battleship tasks
    std::vector<std::pair<Mask, Mask>> tasks;
    tasks.reserve(fleet_placements[0].size() * fleet_placements[1].size());

    for (Mask carrier : fleet_placements[0]) {
        for (Mask battleship : fleet_placements[1]) {
            tasks.emplace_back(carrier, battleship);
        }
    }

    const size_t total_tasks = tasks.size();

    unsigned long long global_hits[CELLS] = {};
    unsigned long long total_configs = 0;
    std::atomic<size_t> done{0};

    double start = omp_get_wtime();

    #pragma omp parallel reduction(+:total_configs)
    {
        unsigned long long local_hits[CELLS] = {};
        unsigned long long local_count = 0;

        #pragma omp for schedule(dynamic, 64)
        for (size_t t = 0; t < total_tasks; t++) {
            Mask carrier = tasks[t].first;
            Mask battleship = tasks[t].second;

            if (!(carrier & battleship)) {
                enumerate(carrier | battleship, 2, fleet_placements, local_hits, local_count);
            }

            size_t prev = done.fetch_add(1, std::memory_order_relaxed);

            // update every 128 tasks to avoid terminal spam
            if ((prev & 127) == true) {
                #pragma omp critical(progress)
                {
                    std::fprintf(stderr, "\r%zu/%zu complete", prev + 1, total_tasks);
                    std::fflush(stderr);
                }
            }
        }

        #pragma omp critical(hits)
        {
            for (int c = 0; c < CELLS; c++) {
                global_hits[c] += local_hits[c];
            }
        }

        total_configs += local_count;
    }

    std::fprintf(stderr, "\r%zu/%zu complete\n", total_tasks, total_tasks);

    double elapsed = omp_get_wtime() - start;

    std::cout << "found " << total_configs << " configs in " << elapsed << "s\n";

    struct CellScore {
        int idx;
        double score;
        double entropy;
        double miss_info;
        double pH;
    };

    std::vector<CellScore> candidates;

    for (int i = 0; i < CELLS; i++) {
        double hits = (double)global_hits[i];
        double misses = (double)total_configs - hits;

        if (hits <= 0.0 || misses <= 0.0) continue;

        double pH = hits / (double)total_configs;
        double pM = misses / (double)total_configs;

        double entropy = -pH * std::log2(pH) - pM * std::log2(pM);
        double miss_info = std::log2((double)total_configs) - std::log2(misses);
        double score = entropy + miss_info * 0.7;

        candidates.push_back({i, score, entropy, miss_info, pH});
    }

    std::sort(
        candidates.begin(),
        candidates.end(),
        [](const CellScore& a, const CellScore& b) {
            return a.score > b.score;
        }
    );

    std::cout << "\nconst OPENING_SEQUENCE = [";
    for (size_t i = 0; i < candidates.size(); i++) {
        int r = candidates[i].idx / GRID;
        int c = candidates[i].idx % GRID;

        std::cout << "\"" << (char)('A' + r) << (c + 1) << "\"";
        if (i + 1 < candidates.size()) std::cout << ",";
    }
    std::cout << "];\n";

    std::cout << "\ntop 20:\n";
    std::cout << "coord  score    entropy  missinfo p(hit)\n";

    int show = std::min(20, (int)candidates.size());
    for (int i = 0; i < show; i++) {
        auto& cs = candidates[i];
        int r = cs.idx / GRID;
        int c = cs.idx % GRID;

        std::printf(
            "%c%d     %.4f   %.4f   %.4f   %.4f\n",
            (char)('A' + r),
            c + 1,
            cs.score,
            cs.entropy,
            cs.miss_info,
            cs.pH
        );
    }

    return 0;
}
