const btn = document.getElementById("analyze");
btn.addEventListener("click", function () {
  btn.disabled = true;
  document.getElementById("cont").style.display = "none";
  document.getElementById("output1").style.display = "none";
  const x = document.getElementById("answer");
  x.innerHTML = "";
  btn.innerHTML = "Analyzing... ";
  document.body.style.backgroundImage = "url(Images/7.gif)";
  chrome.tabs.query({ currentWindow: true, active: true }, function (tabs) {
    var url = tabs[0].url;

    var xhr = new XMLHttpRequest();
    xhr.open("GET", "http://127.0.0.1:5000/summary?url=" + url, true);

    xhr.onload = function () {
      var text = xhr.responseText;

      const p = document.getElementById("output");
      p.innerHTML = text;

      document.getElementById("cont").style.display = "block";
      document.getElementById("output1").style.display = "block";

      const btn2 = document.getElementById("search");

      btn2.addEventListener("click", function () {
        document.getElementById("follow_up").style.backgroundImage = "url(Images/7.gif)";
        var inputValue = document.getElementById("follow_up").value;
        if (inputValue.trim() === "") {
          const p = document.getElementById("answer");
          p.innerHTML = "Please put out your doubts in input box";
          document.getElementById("follow_up").style.backgroundImage =
            "url(Images/2.png)";
        } else {
          var zhr = new XMLHttpRequest();

          zhr.open(
            "GET",
            "http://127.0.0.1:5000/answer?summary=" +
              text +
              " The text provided here is the transcript of the YouTube Video. Based on the text, please answer the question or perform the task given here: " +
              inputValue,
            true
          );

          zhr.onload = function () {
            var ans = zhr.responseText;
            const x = document.getElementById("answer");
            x.innerHTML = ans;
            document.getElementById("follow_up").style.backgroundImage = "url(Images/2.png)";
          };
          zhr.send();
        }
        document.getElementById("follow_up").value = "";
      });

      document.body.style.backgroundImage = "url(Images/2.png)";

      btn.disabled = false;
      btn.innerHTML = "Analyze";
    };

    xhr.send();
  });
});
