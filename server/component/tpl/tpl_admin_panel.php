<?php
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Template for the LLM Agentic Chat admin quick-links panel.
 *
 * Rendered by AgenticChatHooks::renderPanelField() via the `template`
 * style.
 *
 * Expected `$fields` keys:
 *   - configUrl       string  Pre-escaped admin module URL.
 *   - defaultBackend  string  Pre-escaped default backend URL.
 */
$configUrl      = isset($fields['configUrl'])      ? (string) $fields['configUrl']      : '#';
$defaultBackend = isset($fields['defaultBackend']) ? (string) $fields['defaultBackend'] : '';
?>
<div class="card mt-3">
    <div class="card-body">
        <h5 class="card-title"><i class="fa fa-comments"></i> LLM Agentic Chat</h5>
        <p class="card-text">
            Configure the AG-UI backend and the global persona library used by
            the <code>agenticChat</code> CMS style. The default backend is
            <code><?php echo $defaultBackend; ?></code>.
        </p>
        <a href="<?php echo $configUrl; ?>" class="btn btn-primary btn-sm">Open settings</a>
    </div>
</div>
