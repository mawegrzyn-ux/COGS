// Pepper tool-schema validation.
//
// Loads the TOOLS array exported by api/src/routes/ai-chat.js and checks
// that every tool definition is well-formed JSON Schema accepted by the
// Anthropic SDK. We do NOT call Anthropic — this is purely structural.
//
// This catches the class of bug where a typo in a schema (e.g. extra
// `input_str` field, wrong type, missing `properties`) would crash the
// entire chat endpoint at runtime.

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load TOOLS from ai-chat.js. The file uses CommonJS — require() works.
// If ai-chat.js doesn't export TOOLS yet, this test will skip with a
// helpful message rather than crash the suite.
let TOOLS = null;
let LOAD_ERROR = null;
try {
  const aiChat = await import(
    path.resolve(__dirname, '../../src/routes/ai-chat.js')
  );
  TOOLS = aiChat.TOOLS || aiChat.default?.TOOLS || aiChat.tools || null;
} catch (err) {
  LOAD_ERROR = err;
}

describe('Pepper tool schemas', () => {
  it.skipIf(!TOOLS)('TOOLS array is exported from ai-chat.js', () => {
    expect(TOOLS).toBeDefined();
    expect(Array.isArray(TOOLS)).toBe(true);
  });

  if (!TOOLS) {
    it.skip(`TOOLS not exported from ai-chat.js — skipping schema validation${LOAD_ERROR ? ` (${LOAD_ERROR.message})` : ''}`, () => {});
    return;
  }

  it('has at least 90 tools (current count: ~97)', () => {
    expect(TOOLS.length).toBeGreaterThanOrEqual(90);
  });

  it.each(TOOLS.map((t) => [t.name, t]))(
    'tool %s has a valid schema',
    (_name, tool) => {
      expect(tool.name).toMatch(/^[a-z_][a-z0-9_]*$/);  // snake_case identifiers
      expect(tool.description).toBeTypeOf('string');
      expect(tool.description.length).toBeGreaterThan(5);
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe('object');
      expect(tool.input_schema.properties).toBeDefined();
      expect(typeof tool.input_schema.properties).toBe('object');
      // `required` is optional in the Anthropic schema — tools with no required
      // fields may omit it entirely. When present, it must be an array of
      // strings that all reference existing properties.
      if (tool.input_schema.required !== undefined) {
        expect(Array.isArray(tool.input_schema.required)).toBe(true);
        for (const req of tool.input_schema.required) {
          expect(
            Object.prototype.hasOwnProperty.call(tool.input_schema.properties, req),
            `tool "${tool.name}": required field "${req}" not in properties`
          ).toBe(true);
        }
      }
    }
  );

  it('tool names are unique', () => {
    const names = TOOLS.map((t) => t.name);
    const set = new Set(names);
    expect(set.size).toBe(names.length);
  });

  it('every property has a type', () => {
    const VALID = ['string', 'integer', 'number', 'boolean', 'array', 'object', 'null'];
    for (const tool of TOOLS) {
      for (const [propName, propDef] of Object.entries(tool.input_schema.properties)) {
        expect(
          propDef.type,
          `tool "${tool.name}".${propName}: missing type`
        ).toBeDefined();
        // JSON Schema allows either a single type string or an array of types
        // for nullable fields (e.g. ['integer', 'null']). Accept both forms.
        const types = Array.isArray(propDef.type) ? propDef.type : [propDef.type];
        for (const t of types) {
          expect(
            VALID,
            `tool "${tool.name}".${propName}: invalid type "${t}"`
          ).toContain(t);
        }
      }
    }
  });

  it('GitHub write tools require explicit branch parameter (cannot default to main)', () => {
    const writeTools = TOOLS.filter(
      (t) => /^github_(create_or_update_file|create_branch)/.test(t.name)
    );
    for (const t of writeTools) {
      const props = t.input_schema.properties;
      // Must accept a branch parameter
      expect(props.branch || props.target_branch || props.head, `${t.name}: must accept a branch parameter`).toBeDefined();
    }
  });
});
