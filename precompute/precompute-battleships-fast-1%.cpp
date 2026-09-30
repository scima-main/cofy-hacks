#include <iostream>
#include <vector>
#include <array>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <random>
#include <atomic>
#include <omp.h>

constexpr int GRID = 10;
constexpr int CELLS = GRID * GRID;
constexpr long long SAMPLES = 300939755;
const std::vector<int> FLEET = {5, 4, 3, 3, 2};

using Mask = unsigned __int128;

// fast prng for parallel threads
struct FastRNG {
    uint64_t s0, s1;
    FastRNG(uint64_t seed) {
        s0 = seed;
        s1 = seed ^ 0x9E3779B97F4A7C15ULL;
    }
    uint64_t next() {
        uint64_t x = s0;
        uint64_t y = s1;
        s0 = y;
        x ^= x << 23;
        s1 = x ^ y ^ (x >> 17) ^ (y >> 26);
        return s1 + y;
    }
    int operator()(int max) {
        return next() % max;
    }
};

std::vector<Mask> generate_placements(int size) {
    std::vector<Mask> masks;
    for (int r = 0; r < GRID; r++) {
        for (int c = 0; c <= GRID - size; c++) {
            Mask m = 0;
            for (int k = 0; k < size; k++) m |= (Mask)1 << (r * GRID + c + k);
            masks.push_back(m);
        }
    }
    for (int r = 0; r <= GRID - size; r++) {
        for (int c = 0; c < GRID; c++) {
            Mask m = 0;
            for (int k = 0; k < size; k++) m |= (Mask)1 << ((r + k) * GRID + c);
            masks.push_back(m);
        }
    }
    return masks;
}

int main() {
    std::vector<int> sorted_fleet = FLEET;
    std::sort(sorted_fleet.begin(), sorted_fleet.end(), std::greater<>());

    std::vector<std::vector<Mask>> placements;
    for (int sz : sorted_fleet) {
        placements.push_back(generate_placements(sz));
    }

    unsigned long long global_hits[CELLS] = {};

    double start = omp_get_wtime();

    #pragma omp parallel
    {
        FastRNG rng(omp_get_thread_num() * 12345 + 67890);
        unsigned long long local_hits[CELLS] = {};

        #pragma omp for schedule(static)
        for (long long i = 0; i < SAMPLES; i++) {
            Mask occupied = 0;
            bool valid = true;

            for (int s = 0; s < 5; s++) {
                const auto& opts = placements[s];
                Mask chosen = 0;
                int attempts = 0;
                
                // rejection sampling: pick random placement until it doesn't overlap
                while (attempts < 100) {
                    Mask m = opts[rng(opts.size())];
                    if (!(m & occupied)) {
                        chosen = m;
                        break;
                    }
                    attempts++;
                }
                
                if (attempts == 100) {
                    valid = false;
                    break;
                }
                occupied |= chosen;
            }

            if (valid) {
                for (int bit = 0; bit < CELLS; bit++) {
                    if (occupied & ((Mask)1 << bit)) {
                        local_hits[bit]++;
                    }
                }
            }
        }

        #pragma omp critical
        {
            for (int c = 0; c < CELLS; c++) {
                global_hits[c] += local_hits[c];
            }
        }
    }

    double elapsed = omp_get_wtime() - start;
    std::cout << "sampled " << SAMPLES << " fleets in " << elapsed << "s\n";

    struct CellScore {
        int idx;
        double score;
        double entropy;
        double miss_info;
        double pH;
    };

    std::vector<CellScore> candidates;

    // for monte carlo, we use the sample count as our "total configs"
    double total_configs = (double)SAMPLES * 0.85; // approx success rate of rejection sampling

    for (int i = 0; i < CELLS; i++) {
        double hits = (double)global_hits[i];
        if (hits <= 0.0) continue;
        
        double misses = total_configs - hits;
        if (misses <= 0.0) continue;

        double pH = hits / total_configs;
        double pM = misses / total_configs;

        double entropy = -pH * std::log2(pH) - pM * std::log2(pM);
        double miss_info = std::log2(total_configs) - std::log2(misses);
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
