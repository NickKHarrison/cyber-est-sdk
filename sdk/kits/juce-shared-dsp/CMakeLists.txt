# The juce-shared-dsp kit (sdk/docs/porting-juce.md): one source tree, two plugins.
#
#   cmake -S . -B build -DJUCE_DIR=/path/to/your/JUCE -DEST_CLI=/path/to/cyber/sdk/packages/cli/bin/est.mjs
#   cmake --build build                    # the desktop plugin (VST3, AU, Standalone), the reference renderer
#   cmake --build build --target est       # the EST bundle: est/dist/org.example.shared-gain-1.0.0.est
#
# Targets:
#   shared_gain_dsp       the shared DSP (dsp/SharedGain.h), an interface library both plugins use
#   SharedGain            the JUCE plugin, only when JUCE_DIR is set (no JUCE is in Cyber's repository)
#   shared_gain_reference the shared DSP over a WAV, natively, with no JUCE (for est compare)
#   est                   `est pack` on est/: clang to wasm32, the same header (needs Node and est)
cmake_minimum_required(VERSION 3.22)
project(SharedGain VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(shared_gain_dsp INTERFACE)
target_include_directories(shared_gain_dsp INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/dsp)
# The same arithmetic as the module (wasm32 never fuses a multiply and an add).
if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(shared_gain_dsp INTERFACE -ffp-contract=off)
endif()

add_executable(shared_gain_reference reference/render.cpp)
target_link_libraries(shared_gain_reference PRIVATE shared_gain_dsp)
set_target_properties(shared_gain_reference PROPERTIES OUTPUT_NAME reference)

set(JUCE_DIR "" CACHE PATH "Your JUCE checkout (github.com/juce-framework/JUCE); empty: no desktop plugin")
if(JUCE_DIR)
  add_subdirectory(${JUCE_DIR} ${CMAKE_BINARY_DIR}/juce)
  juce_add_plugin(SharedGain
    COMPANY_NAME "Example"
    PLUGIN_MANUFACTURER_CODE Exmp
    PLUGIN_CODE Shgn
    FORMATS VST3 AU Standalone
    PRODUCT_NAME "Shared Gain")
  target_sources(SharedGain PRIVATE juce/PluginProcessor.cpp)
  target_compile_definitions(SharedGain PUBLIC JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0)
  target_link_libraries(SharedGain PRIVATE shared_gain_dsp juce::juce_audio_utils
    PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
else()
  message(STATUS "JUCE_DIR is not set: the desktop plugin is skipped (the reference renderer and the est target still build)")
endif()

# The EST half: est builds it with its own clang (never CMake's compiler: the module is wasm32).
find_program(NODE_EXECUTABLE node)
set(EST_CLI "" CACHE FILEPATH "est's launcher, <cyber>/sdk/packages/cli/bin/est.mjs (empty: `est` on PATH)")
if(EST_CLI)
  set(EST_COMMAND ${NODE_EXECUTABLE} ${EST_CLI})
else()
  find_program(EST_EXECUTABLE est)
  set(EST_COMMAND ${EST_EXECUTABLE})
endif()
add_custom_target(est
  COMMAND ${EST_COMMAND} pack ${CMAKE_CURRENT_SOURCE_DIR}/est
  WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/est
  COMMENT "est pack est/ (the EST bundle from the shared DSP)"
  VERBATIM)
