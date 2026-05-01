<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Template for the global "agentic_chat_personas" JSON editor.
 *
 * Rendered by AgenticChatHooks::renderPersonasField() via the `template`
 * style. The textarea is wrapped in a marker <div> so the React admin
 * bundle (`agentic-admin.umd.js`) can mount the rich editor on top.
 *
 * Expected `$fields` keys:
 *   - inputName  string  Form field name (already escaped).
 *   - value      string  Pre-escaped JSON value.
 *   - disabled   bool    Read-only flag.
 */
$inputName = isset($fields['inputName']) ? (string) $fields['inputName'] : '';
$value     = isset($fields['value'])     ? (string) $fields['value']     : '[]';
$disabled  = !empty($fields['disabled']) ? '1' : '0';
?>
<div class="agentic-chat-personas-field">
    <div class="agentic-chat-personas-root"
         data-name="<?php echo $inputName; ?>"
         data-disabled="<?php echo $disabled; ?>"
         data-config="<?php echo $value; ?>">
        <textarea name="<?php echo $inputName; ?>"
                  class="form-control"
                  rows="10"
                  style="font-family: monospace;"><?php echo $value; ?></textarea>
        <small class="form-text text-muted">
            JSON array of persona objects. Edit the canonical version on the
            LLM Agentic Chat admin module.
        </small>
    </div>
</div>
