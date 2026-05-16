const C = {
  reset:  '\x1b[0m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
};

export function log(message, color = 'reset') {
  console.log(`${C[color] ?? C.reset}${message}${C.reset}`);
}

export function formatResult(result) {
  const status = result.passed
    ? `${C.green}✓ PASS${C.reset}`
    : `${C.red}✗ FAIL${C.reset}`;

  const lines = [`${status}  ${result.pattern}  (${result.duration}ms)`];

  for (const err of result.errors) {
    lines.push(`       ${C.red}ERROR${C.reset} [${err.type}] ${err.message}`);
  }
  for (const warn of result.warnings) {
    lines.push(`       ${C.yellow}WARN${C.reset}  [${warn.type}] ${warn.message}`);
  }

  return lines.join('\n');
}

export function printSummary(results, skipped = 0) {
  const passed       = results.filter(r => r.passed).length;
  const failed       = results.filter(r => !r.passed).length;
  const totalErrors  = results.reduce((n, r) => n + r.errors.length, 0);
  const totalWarns   = results.reduce((n, r) => n + r.warnings.length, 0);
  const totalMs      = results.reduce((n, r) => n + r.duration, 0);
  const avgMs        = results.length > 0 ? Math.round(totalMs / results.length) : 0;

  log('\n' + '='.repeat(60));
  log('Validation Summary', 'cyan');
  log('='.repeat(60));
  log(`Patterns  : ${results.length}`);
  if (skipped > 0) log(`Skipped   : ${skipped} (cached)`, 'gray');
  log(`Passed    : ${passed}`,       passed      > 0 ? 'green'  : 'gray');
  log(`Failed    : ${failed}`,       failed      > 0 ? 'red'    : 'gray');
  log(`Errors    : ${totalErrors}`,  totalErrors > 0 ? 'red'    : 'gray');
  log(`Warnings  : ${totalWarns}`,   totalWarns  > 0 ? 'yellow' : 'gray');
  log(`Time      : ${totalMs}ms  (avg ${avgMs}ms/pattern)`);
  console.log('');
}
