import chalk from 'chalk';

export const log = {
  info: (msg: string) => console.log(chalk.blue('ℹ'), msg),
  success: (msg: string) => console.log(chalk.green('✓'), msg),
  warn: (msg: string) => console.log(chalk.yellow('⚠'), msg),
  error: (msg: string) => console.log(chalk.red('✗'), msg),
  step: (msg: string) => console.log(chalk.cyan('→'), msg),
  dim: (msg: string) => console.log(chalk.dim(msg)),
  header: (msg: string) => console.log('\n' + chalk.bold.underline(msg) + '\n'),
};
