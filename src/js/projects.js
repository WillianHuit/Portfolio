

function viewMore(e){
	if(e.childNodes[1].className  == "info-project-hide"){
		e.childNodes[1].className  = "info-project-show";
	}else{
		e.childNodes[1].className  = "info-project-hide";
	}
	
}
