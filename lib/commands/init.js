const fs = require('fs');
const path = require('path');
const { CliError } = require('../errors');
const { ensureDir, writeJson } = require('../fs-utils');

function runInit(projectName, cwd = process.cwd()) {
  if (!projectName || typeof projectName !== 'string') throw new CliError('Usage: jsonspecs init <project-name>');
  const root = path.resolve(cwd, projectName);
  if (fs.existsSync(root) && fs.readdirSync(root).length > 0) throw new CliError(`Target directory already exists and is not empty: ${root}`);

  ensureDir(path.join(root, 'rules/library'));
  ensureDir(path.join(root, 'rules/entrypoints'));
  ensureDir(path.join(root, 'rules/internal'));
  ensureDir(path.join(root, 'rules/dictionaries'));
  ensureDir(path.join(root, 'operators/node'));
  ensureDir(path.join(root, 'samples'));
  ensureDir(path.join(root, 'docs'));
  ensureDir(path.join(root, 'dist'));

  writeJson(path.join(root, 'manifest.json'), createManifest(projectName));
  writeJson(path.join(root, 'rules/library/order_amount_required.json'), {
    id: 'library.order.amount_required',
    type: 'rule',
    description: 'Сумма заказа обязательна',
    role: 'check',
    operator: 'not_empty',
    level: 'ERROR',
    code: 'ORDER.AMOUNT.REQUIRED',
    message: 'Не указана сумма заказа',
    field: 'order.amount'
  });
  writeJson(path.join(root, 'rules/entrypoints/order_validation.json'), {
    id: 'entrypoints.order.validation',
    type: 'pipeline',
    description: 'Пример проверки заказа',
    strict: false,
    flow: [
      { rule: 'library.order.amount_required' }
    ],
    entrypoint: true,
    required_context: []
  });
  writeJson(path.join(root, 'samples/order.ok.json'), {
    context: { pipelineId: 'entrypoints.order.validation' },
    payload: { order: { amount: 1500 } }
  });
  fs.writeFileSync(path.join(root, 'operators/node/index.js'), operatorPackTemplate(), 'utf8');
  fs.writeFileSync(path.join(root, 'README.md'), readme(projectName), 'utf8');
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\ndist/\n', 'utf8');
  console.log(`[jsonspecs-cli] initialized rules project at ${root}`);
}

function createManifest(projectName) {
  return {
    project: {
      id: projectName,
      title: projectName,
      description: 'Новый rules project на jsonspecs',
      language: 'ru'
    },
    paths: {
      rules: './rules',
      samples: './samples',
      docs: './docs',
      dist: './dist'
    },
    studio: {
      port: 3100,
      openBrowser: true
    },
    build: {
      snapshotFile: 'snapshot.json',
      buildInfoFile: 'build-info.json'
    },
    operatorPacks: {
      node: ['./operators/node']
    },
    catalog: {
      fields: {
        'order.amount': {
          title: 'Сумма заказа',
          description: 'Сумма заказа в валюте операции',
          businessDescription: 'Используется в демонстрационном примере проверки'
        }
      },
      entrypoints: {
        'entrypoints.order.validation': {
          title: 'Проверка заказа',
          description: 'Демонстрационный сценарий проверки заказа'
        }
      },
      artifacts: {
        'library.order.amount_required': {
          title: 'Сумма обязательна',
          description: 'Проверка обязательности суммы заказа'
        }
      },
      operators: {
        not_empty: {
          description: 'должно быть заполнено'
        }
      }
    }
  };
}

function operatorPackTemplate() {
  return `module.exports = {\n  check: {\n    // Example custom check operator:\n    // amount_gt_zero(rule, ctx) {\n    //   const got = ctx.get(rule.field);\n    //   if (!got.ok()) return { ok: false, actual: undefined };\n    //   const n = Number(got.value);\n    //   return { ok: Number.isFinite(n) && n > 0, actual: got.value };\n    // }\n  },\n  predicate: {},\n  meta: {\n    operators: {\n      // amount_gt_zero: { description: 'должно быть больше нуля' }\n    }\n  }\n};\n`;
}

function readme(projectName) {
  return `# ${projectName}\n\nRules project for jsonspecs.\n\n## Commands\n\n- \`jsonspecs studio\`\n- \`jsonspecs validate\`\n- \`jsonspecs build\`\n`; 
}

module.exports = runInit;
