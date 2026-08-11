'use strict';

// ─── Robust code-fence stripper ──────────────────────────────────────────────────────────────
// Handles all ways AI models malform file content:
//  • ```jsx\n<code>\n```  (normal wrapped)
//  • ```jsx\n<code>\n```\nexport default App;  (code AFTER closing fence)
//  • ```jsx export default App;\n<code>  (code ON fence-open line)
//  • multiple nested fence blocks
function stripCodeFences(code) {
  // Remove opening ```lang and closing ```lang (with or without language tag)
  // Handles: ```js ```jsx ```javascript ```python and plain ``` at start/end
  return code
      .replace(/^```[\w.-]*[\t ]*\r?\n/, '')   // opening fence
      .replace(/\r?\n```[\w.-]*[\t ]*$/, '')   // closing fence
      .replace(/^```[\w.-]*[\t ]*\r?\n/, '')   // double-wrapped opening
      .replace(/\r?\n```[\w.-]*[\t ]*$/, '');  // double-wrapped closing
}

module.exports = { stripCodeFences };
