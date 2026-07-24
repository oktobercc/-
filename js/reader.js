/* =====================================================
   Reading OS
   Reader Controller

   Support:
   EPUB
   TXT
   MOBI
   AZW3

===================================================== */


let currentBook = null;

let currentFile = null;

let epubBook = null;

let rendition = null;

let readerType = "";

let startReadTime = null;



// ===============================
// 页面初始化
// ===============================


document.addEventListener(
"DOMContentLoaded",
function(){

    initReader();

});





async function initReader(){


    let data =
    sessionStorage.getItem(
        "currentBook"
    );


    if(!data){

        alert(
        "没有选择书籍"
        );

        location.href =
        "index.html";

        return;

    }



    currentBook =
    JSON.parse(data);



    startReadTime =
    Date.now();



    showBookTitle();



    await loadFile();



}








// ===============================
// 显示标题
// ===============================


function showBookTitle(){


    let title =
    document.querySelector(
        "#reader-title"
    );


    if(title){

        title.innerText =
        currentBook.title;

    }


}









// ===============================
// 获取文件
// ===============================


async function loadFile(){


    let result =
    await getFile(
        currentBook.id
    );



    if(!result){


        alert(
        "找不到电子书文件"
        );


        return;

    }




    currentFile =
    result.file;



    let ext =
    getExtension(
        currentFile.name
    );





    switch(ext){


        case "epub":

            readerType="epub";

            openEPUB();

            break;



        case "txt":

            readerType="txt";

            openTXT();

            break;



        case "mobi":

            readerType="mobi";

            showUnsupported(
            "MOBI格式暂不支持浏览器直接阅读"
            );

            break;



        case "azw3":

            readerType="azw3";

            showUnsupported(
            "AZW3格式暂不支持浏览器直接阅读"
            );

            break;



        default:


            showUnsupported(
            "未知文件格式"
            );

    }



}








function getExtension(
filename
){


    return filename

    .split(".")

    .pop()

    .toLowerCase();


}









// =================================================
// EPUB
// =================================================


async function openEPUB(){


    let url =
    URL.createObjectURL(
        currentFile
    );



    epubBook =
    ePub(url);





    rendition =

    epubBook.renderTo(

        "reader",

        {

            width:"100%",

            height:"100%",

            flow:"paginated"

        }

    );





    await epubBook.ready;





    if(currentBook.position){


        rendition.display(

            currentBook.position

        );


    }

    else{


        rendition.display();


    }





    rendition.on(
    "relocated",

    function(location){



        let cfi =
        location.start.cfi;



        currentBook.position =
        cfi;




        try{


            let percent =

            epubBook
            .locations
            .percentageFromCfi(
                cfi
            );



            let progress =

            Math.floor(
                percent*100
            );



            currentBook.progress =
            progress;



            updateProgress(
            progress
            );



        }

        catch(e){}



        updateBook(
        currentBook
        );



    });



}









// =================================================
// TXT
// =================================================



function openTXT(){


    let reader =
    new FileReader();





    reader.onload =
    function(e){



        let box =
        document.querySelector(
            "#reader"
        );




        box.innerHTML = `


        <div class="text-reader">


        ${
            e.target.result
            .replace(
                /\n/g,
                "<br>"
            )
        }


        </div>


        `;



    };





    reader.readAsText(
        currentFile,
        "UTF-8"
    );



}









// =================================================
// 不支持格式
// =================================================


function showUnsupported(
text
){



    let box =
    document.querySelector(
        "#reader"
    );



    box.innerHTML = `


    <div class="empty-state">


        <h2>

        ${text}

        </h2>


        <p>

        建议使用 Calibre 转换为 EPUB

        </p>


    </div>


    `;



}









// ===============================
// 翻页
// ===============================


function nextPage(){


    if(
    rendition
    ){

        rendition.next();

    }


}




function prevPage(){


    if(
    rendition
    ){

        rendition.prev();

    }


}









// ===============================
// 字体
// ===============================


function increaseFont(){


    if(rendition){


        rendition.themes.fontSize(
            "120%"
        );


    }



    let txt =
    document.querySelector(
        ".text-reader"
    );



    if(txt){

        txt.style.fontSize =
        "120%";

    }


}






function decreaseFont(){


    if(rendition){


        rendition.themes.fontSize(
            "90%"
        );


    }



    let txt =
    document.querySelector(
        ".text-reader"
    );



    if(txt){

        txt.style.fontSize =
        "90%";

    }


}









// ===============================
// 夜间模式
// ===============================


function darkMode(){



    document.body.classList.toggle(
        "dark-reader"
    );



}









// ===============================
// 全屏
// ===============================


function fullScreen(){


    let page =
    document.querySelector(
        ".reader-page"
    );



    if(page.requestFullscreen){

        page.requestFullscreen();

    }


}









// ===============================
// 保存阅读时间
// ===============================


function saveReadTime(){



    let minutes =

    Math.floor(

        (

        Date.now()

        -

        startReadTime

        )

        /

        60000

    );





    currentBook.readTime =

    (

    currentBook.readTime || 0

    )

    +

    minutes;



    updateBook(
        currentBook
    );



}









// ===============================
// 返回
// ===============================


function closeReader(){


    saveReadTime();



    if(rendition){


        rendition.destroy();


    }



    location.href =
    "book-detail.html";


}









// ===============================
// 键盘控制
// ===============================


document.addEventListener(
"keydown",

function(e){


    if(e.key==="ArrowRight"){

        nextPage();

    }



    if(e.key==="ArrowLeft"){

        prevPage();

    }



});









// ===============================
// 暴露
// ===============================


window.nextPage =
nextPage;


window.prevPage =
prevPage;


window.increaseFont =
increaseFont;


window.decreaseFont =
decreaseFont;


window.darkMode =
darkMode;


window.fullScreen =
fullScreen;


window.closeReader =
closeReader;