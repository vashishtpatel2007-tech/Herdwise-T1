with open("scratch/cloud_telemetry.html", "r") as f:
    html = f.read()

# The original file had a <script> tag opened around line 837.
# Then around line 1630, we have <script src="..."> injected inside the existing script.
# We need to close the original script before importing supabase, and open it again.

html = html.replace("<script src=\"https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2\"></script>",
                    "</script>\n<script src=\"https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2\"></script>")

with open("scratch/cloud_telemetry.html", "w") as f:
    f.write(html)
