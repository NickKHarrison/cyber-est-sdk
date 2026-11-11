// See PluginProcessor.h. The parameter's id ("gain") and range match the EST half's kParams (id 0,
// -60 to +12 dB): the desktop and the module are the same plugin, so a project moves between them.
#include "PluginProcessor.h"

namespace {
juce::AudioProcessorValueTreeState::ParameterLayout layout() {
   using Range = juce::NormalisableRange<float>;
   return { std::make_unique<juce::AudioParameterFloat>(juce::ParameterID { "gain", 1 }, "Gain",
                                                       Range((float)shared::Gain::kMinDb, (float)shared::Gain::kMaxDb, 0.1f),
                                                       (float)shared::Gain::kDefaultDb, juce::AudioParameterFloatAttributes().withLabel("dB")) };
}
} // namespace

SharedGainProcessor::SharedGainProcessor()
   : juce::AudioProcessor(BusesProperties().withInput("In", juce::AudioChannelSet::stereo(), true)
                                           .withOutput("Out", juce::AudioChannelSet::stereo(), true)),
     params_(*this, nullptr, "params", layout()) {
   gainDb_ = params_.getRawParameterValue("gain");
}

bool SharedGainProcessor::isBusesLayoutSupported(const BusesLayout &layouts) const {
   return layouts.getMainInputChannelSet() == juce::AudioChannelSet::stereo()
       && layouts.getMainOutputChannelSet() == juce::AudioChannelSet::stereo();
}

void SharedGainProcessor::prepareToPlay(double sampleRate, int) {
   gain_.setGainDb(gainDb_->load());
   gain_.prepare(sampleRate);
}

void SharedGainProcessor::processBlock(juce::AudioBuffer<float> &buffer, juce::MidiBuffer &) {
   juce::ScopedNoDenormals noDenormals;
   // JUCE gives a parameter per block (the EST wrapper splits at each event's frame instead): the
   // value is read in plain units, never JUCE's 0-1 normalised one.
   gain_.setGainDb(gainDb_->load());
   const auto channels = (uint32_t)juce::jmin(buffer.getNumChannels(), 2);
   gain_.process(buffer.getArrayOfReadPointers(), buffer.getArrayOfWritePointers(), channels, 0, (uint32_t)buffer.getNumSamples());
}

// The desktop state is JUCE's (a ValueTree as XML); the EST half's is its own bytes. A shared
// project format, when you need one, is the EST state: see porting-juce.md, "State".
void SharedGainProcessor::getStateInformation(juce::MemoryBlock &dest) {
   if (auto xml = params_.copyState().createXml()) copyXmlToBinary(*xml, dest);
}

void SharedGainProcessor::setStateInformation(const void *data, int size) {
   if (auto xml = getXmlFromBinary(data, size)) params_.replaceState(juce::ValueTree::fromXml(*xml));
}

juce::AudioProcessor *JUCE_CALLTYPE createPluginFilter() { return new SharedGainProcessor(); }
