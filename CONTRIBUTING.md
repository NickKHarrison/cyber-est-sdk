# Contributing

Thank you for wanting to help. This repository is a **mirror**: the kit's sources live in Cyber's own repository and are exported here automatically, so a commit made here would be overwritten by the next export. Contributions therefore go through the owner:

- **Bugs and ideas:** open an issue here. Say which package and version (`est version`), your Node version and operating system, what you ran, and what happened. A plugin folder or `.est` bundle that shows the problem helps most.
- **Changes:** open a pull request here if it is the clearest way to show the change. The owner reviews it and, if it is taken, carries it into Cyber's repository, from where it comes back here with the next export (your authorship is credited in the commit). The pull request itself is then closed rather than merged.
- **Security problems:** never in an issue or pull request. See [SECURITY.md](SECURITY.md).

By contributing you agree that your contribution is licensed under the MIT licence of this repository ([LICENSE](LICENSE)).

## Working on the kit

```
npm ci
npm test              # the kit's suites
npm run build         # stage the three packages
npm run smoke         # pack, install into empty folders, make, validate and pack a template
npm run check         # all of the above, as CI runs it
```

Two rules the checks hold: the packages pin every dependency exactly and declare no install scripts, and two builds of one commit produce the same bytes.
