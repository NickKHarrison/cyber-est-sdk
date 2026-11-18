// A fixture for est port's tests: original code, not a real plugin.
#pragma once
#include <toolkit/Window.h>
#include "../dsp/Echo.h"

class EchoEditor : public toolkit::Window {
public:
    explicit EchoEditor(Echo& echo);
    void paint(toolkit::Painter& p) override;
    void setTint(float amount);
private:
    Echo& echo;
};
