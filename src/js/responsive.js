function btnMenuClick(){
	var x = document.getElementById("itemsBar");
  if (x.className == "items-bar") {
    x.className = "responsive";
  } else {
    x.className = "items-bar";
  }
}
