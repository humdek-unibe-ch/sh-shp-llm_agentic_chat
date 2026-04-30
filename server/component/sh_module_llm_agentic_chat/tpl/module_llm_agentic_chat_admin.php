<?php /* React mount point for the LLM Agentic Chat admin module. */ ?>
<div id="agentic-admin-root"
     class="agentic-admin-root"
     data-config="<?php echo htmlspecialchars($config, ENT_QUOTES | ENT_HTML5, 'UTF-8'); ?>">
    <div class="agentic-admin-loading p-4 text-muted">
        <i class="fa fa-spinner fa-spin mr-2"></i>
        Loading admin module&hellip;
    </div>
</div>
