/* clang 15 names main(argc, argv) "__main_argc_argv", but this older
   Emscripten looks for an export called "main". Bridge the two. */
extern int __main_argc_argv(int, char **);
__attribute__((export_name("main"), used))
int crawl_main_entry(int argc, char **argv)
{
    return __main_argc_argv(argc, argv);
}
