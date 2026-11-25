# The playground

The playground is a page on Cyber's site, at `/playground`. It makes an EST plugin in your browser. There is nothing to install and you do not need an account.

Use it when you cannot or do not want to use the command line: on a phone, on a school computer, or to try an idea in two minutes.

## The three steps

1. **Start.** Press **Effect** or **Instrument**. A small working plugin loads as two files: `assembly/index.ts` (what the plugin does) and `est.json` (its name and its knobs). Change them. Or open **Have a chat assistant write it**, copy the prompt into any chat assistant with one sentence about your idea, and paste its whole answer back, then press **Fill in the files**: the answer is one code block holding five files, each under a `=== file: <path> ===` line. The page fills in the two editors and keeps the plugin's window (`ui/index.html`, `ui/style.css`, `ui/ui.js`) beside them. Signed in to Cyber, the same answer can go straight into Home → EST PLUGINS → **Add a plugin file** instead, which builds it, adds it and opens it with its window.
2. **Build & play.** The page compiles your code, packs it, and checks it the same way Cyber checks every plugin before it runs. An effect then plays on a built-in loop, with **Hear it without the plugin** to compare. An instrument plays a short phrase, and you can play it with the on-screen keys or your computer keys. The plugin's knobs are drawn under it.
3. **Keep it.** **Download .est** saves the plugin. **Download the source** saves the two editors' files as a zip, to carry on later (a pasted window's files are not in it: keep the answer). Signed in to Cyber, **Add to my Cyber** opens Cyber and adds the plugin to your account.

## When the build fails

- **The code did not compile.** Each error is shown as `file:line:column message`, with a button that selects that line. **Copy errors for your assistant** copies them with one line of instruction, ready to paste into the chat.
- **est.json needs fixing.** It is not valid JSON, or a field is wrong. The message says where.
- **The check refused it.** The plugin compiled but broke a rule. You see the rule's words, its id (for example `EST-M005`) and how to fix it. The rules are the same ones `est validate` uses: see [validator-rules.md](validator-rules.md).

## Its limits

- **AssemblyScript only.** For Rust or C++, use the kit: [BUILD_AN_EST_PLUGIN.md](BUILD_AN_EST_PLUGIN.md).
- **One source file.** `assembly/index.ts` and the manifest, with the window's files when a pasted answer brought them. No extra source files, no samples.
- **The window shows in Cyber, not here.** The page plays the plugin with Cyber's generated knobs. A window that came with a pasted answer is tidied and packed with the plugin, and shows once the plugin is added to Cyber. To design a window by hand, use the kit: [ui.md](ui.md).
- **Imports from `"est"` only.** The code cannot name a web address or another package; nothing is fetched.
- **Nothing is stored.** The page does not save what you type, in your browser or anywhere else. If you close the tab, it is gone. Use **Download the source**.
- **Nothing is sent.** Your browser does the compiling. The code you type is not sent to Cyber.
- **Your own id.** The templates use ids like `com.example.my-effect`. That is fine for your own account. To publish on the EST Store later, the id must start with your developer namespace: see [PUBLISH_ON_THE_EST_STORE.md](PUBLISH_ON_THE_EST_STORE.md).

## Moving to the kit later

The files are an ordinary EST project. Make a folder with the kit (`npx @cyber-est/cli new effect-as my-effect`), put your `assembly/index.ts` and `est.json` over its own (and the window's files in `ui/`), and carry on with `npx est dev`.

## If the page is not there

Cyber's owner can switch the playground off. Then `/playground` answers "not found" and Cyber shows no link to it. The kit works as before.
