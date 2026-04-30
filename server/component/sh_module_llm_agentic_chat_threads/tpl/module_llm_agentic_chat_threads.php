<?php /* React mount point for the LLM Agentic Chat Threads admin module. */ ?>
<div id="agentic-threads-root"
     class="agentic-threads-root"
     data-config="<?php echo htmlspecialchars($config, ENT_QUOTES | ENT_HTML5, 'UTF-8'); ?>">
    <div class="agentic-threads-loading p-4 text-muted">
        <i class="fa fa-spinner fa-spin mr-2"></i>
        Loading threads&hellip;
    </div>
</div>
