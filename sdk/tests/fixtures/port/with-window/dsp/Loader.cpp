// A fixture for est port's tests: original code, not a real plugin.
#include "Loader.h"
#include <cstdio>

void Loader::start(const char* path) {
    worker = std::thread([this, path] {
        std::lock_guard<std::mutex> hold(lock);
        FILE* f = fopen(path, "rb");
        if (!f) return;
        fread(impulse, sizeof(float), 1024, f);
        fclose(f);
    });
}

void Loader::join() { if (worker.joinable()) worker.join(); }
