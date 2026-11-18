// A fixture for est port's tests: original code, not a real plugin.
#include "EchoEditor.h"

EchoEditor::EchoEditor(Echo& e) : echo(e) {}
void EchoEditor::paint(toolkit::Painter& p) { p.fill(0x202020); }
void EchoEditor::setTint(float) {}
