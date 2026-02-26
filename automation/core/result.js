/**
 * Result attachment utility for test reporting.
 */

 /**
  * Attach a result object to the test info for debugging.
  * @param {import('playwright').TestInfo} testInfo - Playwright testInfo
  * @param {object} result - Result object to attach
  * @returns {Promise<object>} The result object passed in
  */
 export async function attachResult(testInfo, result) {
   await testInfo.attach('result', {
     body: JSON.stringify(result),
     contentType: 'application/json',
   });
   return result;
 }
