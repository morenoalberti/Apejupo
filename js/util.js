(function () {
  window.U = {
    $: function (id) { return document.getElementById(id); },
    esc: function (s) {
      var d = document.createElement("div");
      d.textContent = s == null ? "" : String(s);
      return d.innerHTML;
    },
    safeUrl: function (u) { return /^https?:\/\//i.test(u || "") ? u : "#"; },
    fmt: function (d, opts) { return new Date(d).toLocaleString("es-ES", opts); }
  };
  var y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
})();
