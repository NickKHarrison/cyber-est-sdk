# A fixture for est port's tests. Never built.
cmake_minimum_required(VERSION 3.20)
project(echo_fixture)
set(CMAKE_CXX_STANDARD 20)
add_library(echo dsp/Echo.cpp dsp/Loader.cpp gui/EchoEditor.cpp)
