package com.twstock.agent;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 註冊自製前景服務外掛（須在 super.onCreate 之前）
        registerPlugin(AnalysisServicePlugin.class);
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            // 關閉 WebView 原生邊緣回彈（橡皮筋效果）
            webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
            // WebView 預設白底，改為開場深色，避免 splash 結束到 web 首次繪製間閃白
            webView.setBackgroundColor(Color.parseColor("#15120E"));
        }
    }
}
