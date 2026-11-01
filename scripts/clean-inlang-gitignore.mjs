// Inlang recreates project.inlang/.gitignore on every compile. Its `*` rule
// silently hides the tracked message files from git, so drop the file right
// after each compile. The root .gitignore keeps it from ever being staged.
import { rmSync } from 'node:fs';

rmSync(new URL('../project.inlang/.gitignore', import.meta.url), { force: true });
