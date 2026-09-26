// A stand-in for a ralph runner: starts one supervised turn and then just stays up, so the
// shutdown test can signal it from outside. The child prints its own pid (through the shell,
// for `shell` mode), so the test can check it is really gone afterwards.
//   node turn-parent.mjs plain|shell|stubborn
import { spawn } from 'node:child_process';
import { superviseTurn } from '../../shared/build-kit/lib/turn.js';

const mode = process.argv[2];
const child = `${mode === 'stubborn' ? "process.on('SIGTERM',()=>{});" : ''}console.log('child '+process.pid);setInterval(()=>{},1000)`;
const viaShell = mode === 'shell';
const proc = viaShell
  ? spawn(`node -e "${child}"`, { shell: true, stdio: ['ignore', 'inherit', 'inherit'] })
  : spawn(process.execPath, ['-e', child], { stdio: ['ignore', 'inherit', 'inherit'] });

superviseTurn(proc, { timeoutMs: 0, label: 'test turn', viaShell, log: (line) => console.error(`[parent] ${line}`) });
setInterval(() => {}, 1000);
