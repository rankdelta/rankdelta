import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const filePath = join(__dirname, '..', 'all-migrations.sql');
let content = readFileSync(filePath, 'utf-8');

// Find all CREATE POLICY statements and add DROP POLICY IF EXISTS before them
const policyPattern = /CREATE POLICY "([^"]+)"\s+ON\s+(\w+)\s+FOR/g;

const policies = [];
let match;
while ((match = policyPattern.exec(content)) !== null) {
    policies.push({
        name: match[1],
        table: match[2],
        index: match.index,
    });
}

// Add DROP POLICY IF EXISTS before each CREATE POLICY (in reverse order to preserve indices)
for (let i = policies.length - 1; i >= 0; i--) {
    const policy = policies[i];
    const insertText = `DROP POLICY IF EXISTS "${policy.name}" ON ${policy.table};\n`;
    content = content.slice(0, policy.index) + insertText + content.slice(policy.index);
}

// Also ensure all CREATE INDEX statements have IF NOT EXISTS
content = content.replace(/CREATE INDEX (?!IF NOT EXISTS)([^\s]+)/g, 'CREATE INDEX IF NOT EXISTS $1');

writeFileSync(filePath, content);
console.log('✅ Made migrations idempotent');
console.log(`   - Added DROP POLICY IF EXISTS for ${policies.length} policies`);
console.log(`   - Ensured all CREATE INDEX have IF NOT EXISTS`);

