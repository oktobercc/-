/* =====================================================
   Reading OS
   Book Detail Controller

   book-detail.html logic

===================================================== */



let currentBook = null;





// ===============================
// 页面初始化
// ===============================


document.addEventListener(
"DOMContentLoaded",
function(){


    loadBookDetail();


});








// ===============================
// 加载书籍信息
// ===============================


function loadBookDetail(){



    let data =

    sessionStorage.getItem(
        "currentBook"
    );



    if(!data){


        alert(
            "未找到书籍信息"
        );


        window.location.href =
        "index.html";


        return;


    }



    currentBook =
    JSON.parse(data);




    renderBook();



}









// ===============================
// 渲染详情页面
// ===============================


function renderBook(){



    // 书名

    setText(
        "book-title",
        currentBook.title
    );





    // 作者

    setText(
        "book-author",
        currentBook.author ||
        "未知作者"
    );





    // 简介

    setText(
        "book-description",

        currentBook.description ||

        "暂无简介"

    );







    // 封面


    let cover =

    document.querySelector(
        "#book-cover"
    );



    if(cover){


        cover.src =

        currentBook.cover ||

        "assets/default-cover.jpg";


    }







    // 标签


    renderTags();






    // 基础信息


    renderMeta();
setText(
    "book-type",
    currentBook.type || "未知"
);


setText(
    "book-status",
    currentBook.status || "未读"
);





    // 阅读进度


    renderProgress();






    // 阅读统计


    renderStatistics();



}









// ===============================
// 标签
// ===============================


function renderTags(){



    let box =

    document.querySelector(
        "#book-tags"
    );



    if(!box)
    return;




    box.innerHTML = "";



    let tags =

    currentBook.tags ||

    [];




    tags.forEach(
    tag=>{


        let span =

        document.createElement(
            "span"
        );


        span.className =
        "detail-tag";


        span.innerText =
        tag;



        box.appendChild(
            span
        );



    });



}









// ===============================
// 基础信息
// ===============================


function renderMeta(){



    let publisher =

    document.querySelector(
        "#book-publisher"
    );



    if(publisher){


        publisher.innerText =

        currentBook.publisher ||

        "未知";


    }






    let year =

    document.querySelector(
        "#book-year"
    );



    if(year){


        year.innerText =

        currentBook.year ||

        "未知";


    }





}









// ===============================
// 阅读进度
// ===============================


function renderProgress(){



    let progress =

    currentBook.progress ||

    0;




    let text =

    document.querySelector(
        "#book-progress"
    );



    if(text){


        text.innerText =

        progress + "%";


    }






    let bar =

    document.querySelector(
        "#progress-value"
    );



    if(bar){


        bar.style.width =

        progress + "%";


    }



}









// ===============================
// 阅读统计
// ===============================


function renderStatistics(){



    setText(

        "read-time",

        (currentBook.readTime || 0)

        +

        " 分钟"

    );





    setText(

        "read-count",

        currentBook.readCount ||

        0

    );






    setText(

        "note-count",

        currentBook.notes ?

        currentBook.notes.length :

        0

    );



}










// ===============================
// 开始阅读
// ===============================


function startReading(){



    if(!currentBook){


        return;


    }





    sessionStorage.setItem(

        "currentBook",

        JSON.stringify(
            currentBook
        )

    );





    window.location.href =

    "reader.html";



}









// ===============================
// 返回书架
// ===============================


function backShelf(){



    window.location.href =

    "index.html";



}









// ===============================
// 收藏
// ===============================


function toggleFavorite(){



    currentBook.favorite =

    !currentBook.favorite;




    sessionStorage.setItem(

        "currentBook",

        JSON.stringify(
            currentBook
        )

    );





    let btn =

    document.querySelector(
        ".favorite-button"
    );




    if(btn){


        btn.innerText =

        currentBook.favorite

        ?

        "★"

        :

        "☆";


    }



}









// ===============================
// 工具函数
// ===============================


function setText(
id,
value
){



    let el =

    document.getElementById(
        id
    );



    if(el){


        el.innerText =
        value;


    }


}









// ===============================
// 暴露函数
// ===============================


window.startReading =
startReading;


window.backShelf =
backShelf;


window.toggleFavorite =
toggleFavorite;