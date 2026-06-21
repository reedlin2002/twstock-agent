package com.twstock.agent;

import android.content.Intent;

import androidx.core.content.ContextCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS 端用 registerPlugin('AnalysisService') 取得的橋接外掛：
 * start({ title, body }) 啟動前景服務、stop() 結束。
 */
@CapacitorPlugin(name = "AnalysisService")
public class AnalysisServicePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String title = call.getString("title", "分析進行中");
        String body = call.getString("body", "");
        Intent intent = new Intent(getContext(), AnalysisForegroundService.class);
        intent.putExtra("title", title);
        intent.putExtra("body", body);
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), AnalysisForegroundService.class);
        getContext().stopService(intent);
        call.resolve();
    }
}
