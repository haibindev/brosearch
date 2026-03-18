
const adapter = require("D:\\prjs\\open\\brosearch\\adapters\\zhihu\\search.js");
const args = {limit: 10, query: 'test', sub: 'MachineLearning', market: 'CN'};
try {
  const js = adapter.buildJs(args);
  if (typeof js !== 'string') throw new Error('not a string');
  console.log(JSON.stringify({ok: true, length: js.length}));
} catch(e) {
  console.log(JSON.stringify({ok: false, error: e.message}));
}
