import { describe, expect, it } from 'vitest';
import { escapeLoneTags } from './escapeLoneTags.ts';

describe('escapeLoneTags', () => {
  it('turns the < of text that looks like a tag into &lt;', () => {
    expect(escapeLoneTags('git checkout <branch> then push.')).toBe('git checkout &lt;branch> then push.');
    expect(escapeLoneTags('Returns Promise<void> and Vec<u8>')).toBe('Returns Promise&lt;void> and Vec&lt;u8>');
    expect(escapeLoneTags('Use Component<P> and Foo<I> here')).toBe('Use Component&lt;P> and Foo&lt;I> here');
    expect(escapeLoneTags('Set it:\n\n<your-token>\n\nthen go')).toBe('Set it:\n\n&lt;your-token>\n\nthen go');
    expect(escapeLoneTags('if x<y and z>w')).toBe('if x&lt;y and z>w');
    expect(escapeLoneTags('Wrap it in a <details> element.')).toBe('Wrap it in a &lt;details> element.');
    expect(escapeLoneTags('a <table>t</table> b')).toBe('a &lt;table>t&lt;/table> b');
    expect(escapeLoneTags('<details> hides content.\n\nNext.')).toBe('&lt;details> hides content.\n\nNext.');
    expect(escapeLoneTags('<b>\n\nNext.')).toBe('&lt;b>\n\nNext.');
  });

  it('leaves HTML that is paired, void or a comment', () => {
    for (const text of [
      '<details>\n<summary>More</summary>\n\nHidden **text**\n\n- a\n\n</details>\n\nAfter',
      'Press <kbd>Ctrl</kbd> and <b>bold <i>it</i></b> x<br>y <img src="https://example.com/a.png">',
      '| a |\n|---|\n| one<br>two |',
      '<div align="center">\n\n**Title**\n\n</div>',
      '<pre>\ncode <b>x</b>\n\nmore\n</pre>\n\nAfter',
      '<script>alert(1)</script>\n\nAfter',
      '<script>if (a<b) { x() }</script>',
      '<!-- <details> -->\n\nText',
      '<ul><li>a<li>b</ul>',
      '<table>\n<tr><td>a<td>b\n</table>',
      '<div>\n<b>x</b>\n</div>',
    ]) expect(escapeLoneTags(text), text).toBe(text);
  });

  it('does not touch a < inside maths', () => {
    for (const text of ['$x<y$', 'If $a<b$ then', 'So $a<b$ and $c<d>e$.', '$$\na<b\nc<d>e\n$$\n\nAfter', 'A $$x<y$$ line', '```math\na<b\n```']) {
      expect(escapeLoneTags(text), text).toBe(text);
    }
    // Outside the formula it is still text.
    expect(escapeLoneTags('If $a<b$ then <branch> and x<y')).toBe('If $a<b$ then &lt;branch> and x<y');
    // Without a closing $ there is no formula.
    expect(escapeLoneTags('If $a<b> then')).toBe('If $a&lt;b> then');
  });

  it('leaves code spans, fences and an existing &lt; as they are', () => {
    for (const text of ['Use `<details>` and `Promise<void>` here', '```html\n<script>\n<b>\n```', '    <b>\n    indented code', 'a &lt;b&gt; c &lt;details&gt;']) {
      expect(escapeLoneTags(text), text).toBe(text);
    }
    expect(escapeLoneTags('a &lt;b&gt; and <c>')).toBe('a &lt;b&gt; and &lt;c>');
  });

  it('finds the tag in a quote or a list item at its place in the source', () => {
    expect(escapeLoneTags('> <details> hides\n>\n> After.')).toBe('> &lt;details> hides\n>\n> After.');
    expect(escapeLoneTags('> <div>\n> <b>bold\n> </div>')).toBe('> <div>\n> &lt;b>bold\n> </div>');
    expect(escapeLoneTags('>\t<details> hides\n>\n> After.')).toBe('>\t&lt;details> hides\n>\n> After.');
    expect(escapeLoneTags('> <div>\n>\t<b>bold\n> </div>')).toBe('> <div>\n>\t&lt;b>bold\n> </div>');
    expect(escapeLoneTags('- <pre> in a list\n- next')).toBe('- &lt;pre> in a list\n- next');
    expect(escapeLoneTags('1. item\n\n   <div>\n   <b>bold\n   </div>')).toBe('1. item\n\n   <div>\n   &lt;b>bold\n   </div>');
  });

  it('does not let an unclosed block tag pair with an end tag in code', () => {
    const text = '<script> tags go at the end.\n\n```html\n<script src="x"></script>\n```\n\nAfter the code.';
    expect(escapeLoneTags(text)).toBe('&lt;script> tags go at the end.\n\n```html\n<script src="x"></script>\n```\n\nAfter the code.');
  });

  it('escapes every stray opener, also those an earlier one swallowed', () => {
    const text = Array.from({ length: 14 }, (_, i) => `<script> stray ${i}.`).join('\n\n') + '\n\nEnd.';
    const out = escapeLoneTags(text);
    expect(out.match(/&lt;script>/g)).toHaveLength(14);
    expect(out).not.toMatch(/<script/);
    expect(escapeLoneTags(text.replace(/\n\n/g, '\n'))).not.toMatch(/<script/);
    // Strays that only show once the one before is text: each an opener with nothing after it.
    const bare = Array.from({ length: 12 }, () => '<style>').join('\n\n') + '\n\nEnd.';
    expect(escapeLoneTags(bare)).not.toMatch(/<style/);
    expect(escapeLoneTags(bare)).toContain('End.');
  });

  it('does not add backslashes or change an HTML block with a stray tag in it', () => {
    expect(escapeLoneTags('<div>\n<b>bold\n</div>\n\nAfter paragraph.')).toBe('<div>\n&lt;b>bold\n</div>\n\nAfter paragraph.');
  });

  it('is idempotent', () => {
    for (const text of [
      'git checkout <branch> then push.',
      '<pre> is the tag for code.\n\nNext **bold**.\n\n- list',
      '<div>\n<b>bold\n</div>\n\nAfter paragraph.',
      '<script> tags.\n\n```html\n<script src="x"></script>\n```\n\nAfter',
      '> <div>\n> <b>bold\n> </div>',
      'Body </details> end\n\n<details>\n<summary>s</summary>\n\nBody </details>',
      Array.from({ length: 14 }, (_, i) => `<script> stray ${i}.`).join('\n\n'),
      'Wrap it in a <details> element.\n\nSecond.\n\n- list',
      '<DETAILS>x</DETAILS> and <Br>',
    ]) {
      const once = escapeLoneTags(text);
      expect(escapeLoneTags(once), text).toBe(once);
    }
  });
});
