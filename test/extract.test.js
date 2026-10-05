import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractBlockContent, extractHtmlBlockContent } from '../src/editor.js';

const PARAGRAPH = '<!-- wp:paragraph -->\n<p>Hello</p>\n<!-- /wp:paragraph -->';

test('html: block markup without a header is returned as is', () => {
  assert.equal(extractHtmlBlockContent(PARAGRAPH), PARAGRAPH);
});

test('html: a leading header of HTML comments is stripped', () => {
  const file = '<!-- SUGGESTED TITLE: Hello -->\n<!-- Note: draft -->\n\n' + PARAGRAPH + '\n';
  assert.equal(extractHtmlBlockContent(file), PARAGRAPH);
});

test('html: Blade comments mixed with HTML comments are stripped', () => {
  const file = '{{-- fixture --}}\n<!-- note -->\n{{-- multi\nline --}}\n' + PARAGRAPH;
  assert.equal(extractHtmlBlockContent(file), PARAGRAPH);
});

test('html: a leading BOM does not block header stripping', () => {
  assert.equal(extractHtmlBlockContent('﻿<!-- note -->\n' + PARAGRAPH), PARAGRAPH);
});

test('html: compact block delimiters are not mistaken for header comments', () => {
  const compact = '<!--wp:paragraph--><p>x</p><!--/wp:paragraph-->';
  assert.equal(extractHtmlBlockContent('<!-- note -->' + compact), compact);
});

test('html: comments that merely start with "wp" are header comments', () => {
  assert.equal(extractHtmlBlockContent('<!-- wpfoo: note -->\n' + PARAGRAPH), PARAGRAPH);
});

test('html: comments after the first block are content and kept', () => {
  const file = PARAGRAPH + '\n<!-- kept -->\n' + PARAGRAPH;
  assert.equal(extractHtmlBlockContent('<!-- header -->\n' + file), file);
});

test('html: content that does not start with an opening block returns null', () => {
  assert.equal(extractHtmlBlockContent('<!-- note -->\n<p>Plain HTML</p>'), null);
  assert.equal(extractHtmlBlockContent('<!-- /wp:group -->'), null);
  assert.equal(extractHtmlBlockContent('<!-- unterminated\n' + PARAGRAPH), null);
  assert.equal(extractHtmlBlockContent(''), null);
});

test('extractBlockContent routes .html files to the HTML extractor', () => {
  assert.equal(extractBlockContent('<!-- note -->\n' + PARAGRAPH, '/x/fixture.html'), PARAGRAPH);
});

test('extractBlockContent strips the PHP header of .php files', () => {
  const file = "<?php\n/**\n * Title: Hello\n */\n?>\n" + PARAGRAPH;
  assert.equal(extractBlockContent(file, '/x/hello.php'), PARAGRAPH);
});

test('extractBlockContent replaces inline PHP in .php files', () => {
  const file = "<?php\n/** Title: Hi */\n?>\n<!-- wp:paragraph -->\n<p><?php esc_html_e( 'Hi & bye', 'elayne' ); ?></p>\n<!-- /wp:paragraph -->";
  assert.equal(extractBlockContent(file, '/x/hi.php'), '<!-- wp:paragraph -->\n<p>Hi &amp; bye</p>\n<!-- /wp:paragraph -->');
});
