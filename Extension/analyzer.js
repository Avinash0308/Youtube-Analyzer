const btn = document.getElementById("analyze");
srh.disabled = true;
btn.addEventListener("click", function() {
    btn.disabled = true;
    btn.innerHTML = "Analyzing...";
    chrome.tabs.query({currentWindow: true, active: true}, function(tabs){
        var url = tabs[0].url;
        var xhr = new XMLHttpRequest();
        xhr.open("GET", "http://127.0.0.1:5000/summary?url=" + url, true);
        xhr.onload = function() {
            var text = xhr.responseText;
            const p = document.getElementById("output");
            p.innerHTML = text;
            btn.disabled = false;
            btn.innerHTML = "Analyze";
        }
        xhr.send();
    });
});