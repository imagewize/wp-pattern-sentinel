import { createInterface } from 'readline';

/**
 * Prompt the user for a value. Pass hidden: true for passwords
 * (masks input with asterisks).
 */
export function prompt(question, { hidden = false } = {}) {
  return new Promise(resolve => {
    if (!hidden) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question(question, answer => { rl.close(); resolve(answer); });
      return;
    }

    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    let value = '';

    const onData = char => {
      if (char === '\r' || char === '\n' || char === '') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (char === '' || char === '') {
        if (value.length > 0) {
          value = value.slice(0, -1);
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          process.stdout.write(question + '*'.repeat(value.length));
        }
      } else {
        value += char;
        process.stdout.write('*');
      }
    };

    process.stdin.on('data', onData);
  });
}
