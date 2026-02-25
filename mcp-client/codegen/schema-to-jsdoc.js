/**
 * Pure function: derive JSDoc type string from JSON Schema property.
 * @param {object} prop - JSON Schema property object
 * @returns {string} JSDoc type string
 */
export function schemaToJSDoc(prop) {
  if (!prop || !prop.type) {
    return 'any';
  }

  switch (prop.type) {
    case 'string':
      if (prop.enum) {
        return prop.enum.map(v => `'${v}'`).join('|');
      }
      return 'string';

    case 'boolean':
      return 'boolean';

    case 'number':
    case 'integer':
      return 'number';

    case 'object':
      return 'object';

    case 'array':
      if (prop.items) {
        const itemType = schemaToJSDoc(prop.items);
        return `${itemType}[]`;
      }
      return 'any[]';

    default:
      return 'any';
  }
}
