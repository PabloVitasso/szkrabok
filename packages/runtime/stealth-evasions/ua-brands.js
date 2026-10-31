// ua-brands.js — Chrome's UA-CH GREASE brand list, derived from the major version.
//
// Port of Chromium components/embedder_support/user_agent_utils.cc:
// GenerateBrandVersionList + GetGreasedUserAgentBrandVersion + GetRandomOrder
// (size 3). Real Chrome builds [GREASE, Chromium, Google Chrome] and places
// entry i at index order[i], with order, GREASE characters and GREASE version
// all picked by the major version.
//
// greasedBrands is injected verbatim into playwright-core's coreBundle.js by
// greasy-brands-patch.js (via toString), so it must stay self-contained:
// no imports, no references outside its own body. Any edit changes the block
// hash, so installed cores pick it up on the next postinstall.

/**
 * Brand list for navigator.userAgentData.brands / Sec-CH-UA.
 * Pass fullVersion (e.g. '131.0.6778.86') to get the fullVersionList form.
 * @param {number} major Chrome major version
 * @param {string} [fullVersion]
 * @returns {{brand: string, version: string}[]}
 */
export const greasedBrands = (major, fullVersion) => {
  const chars = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'];
  const greaseVersion = ['8', '99', '24'][major % 3];
  const order = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ][major % 6];
  const version = fullVersion || String(major);
  const list = [
    {
      brand: `Not${chars[major % 11]}A${chars[(major + 1) % 11]}Brand`,
      version: fullVersion ? `${greaseVersion}.0.0.0` : greaseVersion,
    },
    { brand: 'Chromium', version },
    { brand: 'Google Chrome', version },
  ];
  const brands = [];
  for (let i = 0; i < 3; i++) brands[order[i]] = list[i];
  return brands;
};

/** Chrome major version from a user-agent string, or null when it has none. */
export const chromeMajor = ua => {
  const m = /Chrome\/(\d+)/.exec(ua || '');
  return m ? parseInt(m[1], 10) : null;
};
