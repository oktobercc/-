/* =====================================================
   Reading OS
   Bookshelf Controller

   index.html logic

===================================================== */



let books = [];





// ===============================
// 页面初始化
// ===============================


document.addEventListener(
"DOMContentLoaded",

function(){


    initApp();


});








async function initApp(){



    books = getBooks();



    renderBooks();



    updateBookCount();



    initTheme();



}









// ===============================
// 渲染书架
// ===============================


function renderBooks(){



    let container =

    document.querySelector(
        "#bookshelf"
    );



    if(!container)
    return;



    container.innerHTML="";





    if(books.length===0){



        container.innerHTML = `


        <div class="empty-books">


            <h3>
            书架还是空的
            </h3>


            <p>
            添加一本书开始阅读吧
            </p>


        </div>


        `;


        return;


    }






    books.forEach(
    book=>{


        let card =

        createBookCard(
            book
        );



        container.appendChild(
            card
        );



    });



}









// ===============================
// 创建书籍卡片
// ===============================


function createBookCard(
book
){



    let div =

    document.createElement(
        "div"
    );



    div.className =
    "book-card";





    div.onclick =

    function(e){



        // 点击删除按钮不跳转

        if(
        e.target.classList.contains(
            "delete-book"
        )
        ){

            return;

        }



        openBook(
            book.id
        );



    };






    div.innerHTML = `


    <div class="book-cover-wrapper">


        <img

        class="book-cover"

        src="${

        book.cover ||

        "assets/default-cover.jpg"

        }">


    </div>





    <div class="book-info">



        <div class="book-title">

            ${book.title || "未命名"}

        </div>




        <div class="book-author">

            ${book.author || "未知作者"}

        </div>




        <span class="book-status

        ${getStatusClass(book.status)}

        ">

            ${book.status || "未读"}

        </span>






        <div class="progress-box">



            <div class="progress-text">


                <span>
                阅读进度
                </span>



                <span>

                ${book.progress || 0}%

                </span>



            </div>





            <div class="progress-bar">


                <div

                class="progress-value"

                style="width:${

                book.progress || 0

                }%">

                </div>



            </div>




        </div>




        <button

        class="delete-book"

        onclick="deleteBookItem(event,${book.id})">

        删除

        </button>




    </div>



    `;




    return div;



}









// ===============================
// 打开书籍详情
// ===============================


function openBook(
id
){



    let book =

    books.find(

        b=>

        b.id===id

    );





    if(!book)
    return;





    sessionStorage.setItem(

        "currentBook",

        JSON.stringify(
            book
        )

    );





    window.location.href =

    "book-detail.html";



}









// ===============================
// 删除书籍
// ===============================


async function deleteBookItem(
event,
id
){



    event.stopPropagation();





    let confirmDelete =

    confirm(

    "确定删除这本书吗？"

    );





    if(!confirmDelete)
    return;





    await deleteBook(
        id
    );





    books =

    getBooks();





    renderBooks();



    updateBookCount();



}









// ===============================
// 搜索
// ===============================


function searchBooks(
keyword
){



    keyword =

    keyword
    .toLowerCase();





    let cards =

    document.querySelectorAll(

        ".book-card"

    );





    books.forEach(
    (book,index)=>{


        let card =

        cards[index];



        let text =

        (

        book.title +

        book.author

        )

        .toLowerCase();





        if(
        text.includes(
            keyword
        )
        ){


            card.classList.remove(
                "hidden"
            );


        }

        else{


            card.classList.add(
                "hidden"
            );


        }



    });



}









// ===============================
// 添加书籍入口
// ===============================


function openImport(){



    /*
    
    未来连接 import.js

    例如：

    importBook()

    */


    alert(

    "导入功能开发中"

    );


}









// ===============================
// 书籍数量
// ===============================


function updateBookCount(){



    let count =

    document.querySelector(

        "#book-count"

    );





    if(count){


        count.innerText =

        books.length;



    }



}









// ===============================
// 状态样式
// ===============================


function getStatusClass(
status
){



    switch(status){


        case "在读":

            return "status-reading";



        case "已读":

            return "status-read";



        case "暂停":

            return "status-paused";



        default:

            return "status-unread";



    }



}









// ===============================
// 主题
// ===============================


function initTheme(){



    let theme =

    localStorage.getItem(
        "theme"
    );





    if(
    theme==="dark"
    ){


        document.body.classList.add(
            "dark"
        );


    }



}






function toggleTheme(){



    document.body.classList.toggle(
        "dark"
    );





    let dark =

    document.body.classList.contains(
        "dark"
    );





    localStorage.setItem(

        "theme",

        dark

        ?

        "dark"

        :

        "light"

    );



}









// ===============================
// 暴露函数
// ===============================


window.openBook =
openBook;


window.deleteBookItem =
deleteBookItem;


window.searchBooks =
searchBooks;


window.openImport =
openImport;


window.toggleTheme =
toggleTheme;