// A fixture for est port's tests: original code, not a real plugin.
#pragma once
#include <thread>
#include <mutex>

// Reads an impulse from disk on a worker thread.
class Loader {
public:
    void start(const char* path);
    void join();
private:
    std::thread worker;
    std::mutex lock;
    float impulse[1024];
};
