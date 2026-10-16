package com.local.chatboxtavern;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "DocumentSaver")
public class DocumentSaverPlugin extends Plugin {
    @PluginMethod
    public void saveFile(PluginCall call) {
        String source = call.getString("sourceUri");
        if (source == null) { call.reject("缺少导出文件"); return; }
        try {
            Uri uri = Uri.parse(source);
            if (!"file".equals(uri.getScheme())) { call.reject("只能导出本应用的临时文件"); return; }
            File file = new File(uri.getPath()).getCanonicalFile();
            String cache = getContext().getCacheDir().getCanonicalPath() + File.separator;
            String files = getContext().getFilesDir().getCanonicalPath() + File.separator;
            if ((!file.getPath().startsWith(cache) && !file.getPath().startsWith(files)) || !file.isFile()) { call.reject("导出文件不可读取"); return; }
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(call.getString("mimeType", "application/octet-stream"));
            intent.putExtra(Intent.EXTRA_TITLE, new File(call.getString("suggestedName", "故事备份.json")).getName());
            startActivityForResult(call, intent, "documentChosen");
        } catch (Exception e) { call.reject("准备导出失败", e); }
    }

    @ActivityCallback
    private void documentChosen(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) { call.reject("User canceled file save", "SAVE_CANCELED"); return; }
        Uri target = result.getData().getData();
        new Thread(() -> {
            try (InputStream input = new FileInputStream(new File(Uri.parse(call.getString("sourceUri")).getPath())); OutputStream output = getContext().getContentResolver().openOutputStream(target, "w")) {
                if (output == null) throw new java.io.IOException("无法打开保存位置");
                byte[] buffer = new byte[65536]; int read;
                while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                output.flush();
                JSObject saved = new JSObject(); saved.put("uri", target.toString()); call.resolve(saved);
            } catch (Exception e) { call.reject("保存文件失败", e); }
        }).start();
    }
}
