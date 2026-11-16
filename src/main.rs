use std::{env, error::Error, fs, path::PathBuf, process};
use txt2epub::{build_epub, parse_book};

fn main() {
    if let Err(error) = run() {
        eprintln!("错误：{error}");
        process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let mut input = None;
    let mut output = None;
    let mut title = None;
    let mut author = String::from("未知作者");
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-h" | "--help" => {
                println!(
                    "用法：txt2epub <输入.txt> [输出.epub] [--title 书名] [--author 作者]\n输入文件须为 UTF-8 编码；输出路径默认与输入文件同名。\n章节标题支持“第一章 标题”和“Chapter 1 Title”。"
                );
                return Ok(());
            }
            "--title" => title = Some(args.next().ok_or("--title 需要一个值")?),
            "--author" => author = args.next().ok_or("--author 需要一个值")?,
            _ if arg.starts_with('-') => return Err(format!("未知参数：{arg}").into()),
            _ if input.is_none() => input = Some(PathBuf::from(arg)),
            _ if output.is_none() => output = Some(PathBuf::from(arg)),
            _ => return Err("位置参数过多".into()),
        }
    }
    let input: PathBuf = input.ok_or("缺少输入 TXT 文件；用 --help 查看用法")?;
    let output = output.unwrap_or_else(|| input.with_extension("epub"));
    if input == output {
        return Err("输出路径不能与输入文件相同".into());
    }
    let text = fs::read_to_string(&input)
        .map_err(|error| format!("读取 {} 失败：{error}", input.display()))?;
    let title = title.unwrap_or_else(|| {
        input
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned()
    });
    let book = parse_book(&text, &title);
    let epub = build_epub(&book, &author)?;
    fs::write(&output, epub).map_err(|error| format!("写入 {} 失败：{error}", output.display()))?;
    println!("已生成：{}（{} 章）", output.display(), book.chapters.len());
    Ok(())
}
