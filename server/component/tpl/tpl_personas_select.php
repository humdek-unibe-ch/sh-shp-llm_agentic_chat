<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Template for the section-level "personas to use" multi-select widget.
 *
 * Rendered by AgenticChatHooks::buildPersonaPickerWidget() through the
 * `template` style (which `include`s this file directly and therefore
 * does not HTML-escape its output).
 *
 * Wire-format choice
 * ------------------
 * The `<select multiple>` posts every selected option as
 * `fields[name][lang][gender][content][]`. CmsUpdateController::update()
 * receives that as an array and `implode(',', …)`s it into a CSV string
 * before persisting (see core: `if(is_array($content)){ $content = implode(',', $content); }`).
 * AgenticChatHooks::normalizeStoredKeys() reads the CSV back transparently.
 *
 * We deliberately do NOT use a hidden input updated by an inline `onchange`
 * handler — the CMS pages send a CSP `script-src` directive with a hash,
 * which disables `'unsafe-inline'` and silently blocks inline event
 * handlers.
 *
 * The CMS save handler also reads `$field['type']`, `$field['id']` and
 * `$field['relation']` for every submitted entry, so we must emit those
 * as hidden inputs alongside the `[content][]` values, otherwise
 * `update()` fails with "Undefined array key 'type'".
 *
 * Expected `$fields` keys (all pre-escaped where needed):
 *   - inputName     string  Form name for the select (will get `[]` appended).
 *   - namePrefix    string  Form name prefix shared by id/type/relation.
 *   - fieldId       int     Source field id (for `[id]`).
 *   - fieldType     string  Source field type (for `[type]`).
 *   - fieldRelation string  Source field relation (for `[relation]`).
 *   - optionsHtml   string  Pre-rendered <option> markup (with `selected` set).
 *   - domId         string  Pre-escaped DOM id prefix.
 *   - disabled      bool    Whether the picker is read-only.
 */
$inputName     = isset($fields['inputName'])     ? (string) $fields['inputName']     : '';
$namePrefix    = isset($fields['namePrefix'])    ? (string) $fields['namePrefix']    : '';
$fieldId       = isset($fields['fieldId'])       ? (int) $fields['fieldId']          : 0;
$fieldType     = isset($fields['fieldType'])     ? (string) $fields['fieldType']     : 'agentic-chat-personas-select';
$fieldRelation = isset($fields['fieldRelation']) ? (string) $fields['fieldRelation'] : '';
$optionsHtml   = isset($fields['optionsHtml'])   ? (string) $fields['optionsHtml']   : '';
$domId         = isset($fields['domId'])         ? (string) $fields['domId']         : '';
$disabledAttr  = !empty($fields['disabled']) ? 'disabled' : '';
?>
<div class="agentic-chat-personas-picker form-group" data-personas-picker>
    <input type="hidden" name="<?php echo $namePrefix; ?>[id]"       value="<?php echo $fieldId; ?>">
    <input type="hidden" name="<?php echo $namePrefix; ?>[type]"     value="<?php echo $fieldType; ?>">
    <input type="hidden" name="<?php echo $namePrefix; ?>[relation]" value="<?php echo $fieldRelation; ?>">
    <select id="<?php echo $domId; ?>-select"
            name="<?php echo $inputName; ?>[]"
            multiple
            class="form-control selectpicker"
            data-live-search="true"
            data-actions-box="true"
            data-size="10"
            <?php echo $disabledAttr; ?>>
        <?php echo $optionsHtml; ?>
    </select>
    <small class="form-text text-muted">
        Pick which personas (defined in the global LLM Agentic Chat configuration page) take part
        in this section's chat. Leave empty to use every enabled persona from the global library.
    </small>
</div>
