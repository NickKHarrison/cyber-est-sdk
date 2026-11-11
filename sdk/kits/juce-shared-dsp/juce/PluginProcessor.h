// The desktop half of the kit (sdk/docs/porting-juce.md): a JUCE AudioProcessor whose DSP is the
// shared header, ../dsp/SharedGain.h. Built by CMakeLists.txt only when JUCE_DIR names your own
// JUCE checkout (no JUCE source is in Cyber's repository: its licence is yours to accept). It is
// not compiled by Cyber's suite or CI; the EST half and the reference renderer are.
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include "SharedGain.h"

class SharedGainProcessor : public juce::AudioProcessor {
public:
   SharedGainProcessor();

   void prepareToPlay(double sampleRate, int samplesPerBlock) override;
   void releaseResources() override {}
   bool isBusesLayoutSupported(const BusesLayout &layouts) const override;
   void processBlock(juce::AudioBuffer<float> &, juce::MidiBuffer &) override;

   juce::AudioProcessorEditor *createEditor() override { return new juce::GenericAudioProcessorEditor(*this); }
   bool hasEditor() const override { return true; }

   const juce::String getName() const override { return "Shared Gain"; }
   bool acceptsMidi() const override { return false; }
   bool producesMidi() const override { return false; }
   double getTailLengthSeconds() const override { return 0.0; }

   int getNumPrograms() override { return 1; }
   int getCurrentProgram() override { return 0; }
   void setCurrentProgram(int) override {}
   const juce::String getProgramName(int) override { return {}; }
   void changeProgramName(int, const juce::String &) override {}

   void getStateInformation(juce::MemoryBlock &) override;
   void setStateInformation(const void *, int) override;

private:
   juce::AudioProcessorValueTreeState params_;
   std::atomic<float> *gainDb_ = nullptr;
   shared::Gain gain_;

   JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(SharedGainProcessor)
};
