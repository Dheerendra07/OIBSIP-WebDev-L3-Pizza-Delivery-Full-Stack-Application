import { randomBytes } from 'node:crypto';

const PLACEHOLDER_SECRET = /replace-with|change-this|example|your[-_ ]|<[^>]+>/i;

function readValue(content, key) {
  const line = content.split(/\r?\n/).find((item) => new RegExp(`^\\s*${key}\\s*=`).test(item));
  if (!line) return undefined;
  const value = line.slice(line.indexOf('=') + 1).trim();
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

function setValue(content, key, value) {
  const expression = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
  if (expression.test(content)) return content.replace(expression, `${key}=${value}`);
  return `${content.trimEnd()}\n${key}=${value}\n`;
}

function hasUsableSecret(value) {
  return typeof value === 'string' && value.length >= 32 && !PLACEHOLDER_SECRET.test(value);
}

/**
 * Prepare local env content without overwriting any existing application/provider settings.
 * A generated session secret is returned only inside the content written by the local CLI;
 * this function and CLI never print its value.
 */
export function prepareLocalEnv(template, existingContent, secretFactory = () => randomBytes(48).toString('base64url')) {
  if (typeof template !== 'string' || !template.trim()) throw new Error('Root .env.example is missing or empty.');
  let content = typeof existingContent === 'string' ? existingContent : template;
  const nodeEnv = readValue(content, 'NODE_ENV');

  if (nodeEnv?.toLowerCase() === 'production') {
    throw new Error('Refusing to modify server/.env marked NODE_ENV=production. Create/configure a separate local development env first.');
  }

  if (!nodeEnv) content = setValue(content, 'NODE_ENV', 'development');

  const currentSecret = readValue(content, 'JWT_SECRET');
  let generatedJwtSecret = false;
  if (!hasUsableSecret(currentSecret)) {
    const replacement = secretFactory();
    if (!hasUsableSecret(replacement)) throw new Error('The local JWT secret generator did not return a strong secret.');
    content = setValue(content, 'JWT_SECRET', replacement);
    generatedJwtSecret = true;
  }

  return {
    content: content.endsWith('\n') ? content : `${content}\n`,
    created: typeof existingContent !== 'string',
    generatedJwtSecret,
  };
}
