// Aim Prac: humans play CT only - the T side belongs to the knife-bot horde
// (yb_join_team "t" in yapb.cfg). The in-browser team menu doesn't render, so
// joins come from the F1/F2 binds in the shared valve.zip userconfig.cfg,
// which can't differ per mod - F1 (jointeam 1, Ts) must keep working on the
// other mods. Redirect human T/auto joins to CT server-side instead.

#include <amxmodx>

public plugin_init()
{
	register_plugin("Force Humans CT", "0.1.0", "frag-friday");
	register_clcmd("jointeam", "cmd_jointeam");
}

public cmd_jointeam(id)
{
	// YaPB issues its own jointeam for bots - leave it alone
	if (is_user_bot(id))
		return PLUGIN_CONTINUE;

	new arg[4];
	read_argv(1, arg, charsmax(arg));

	// 1 = T, 5 = auto-assign; 2 (CT) and 6 (spectate, the F3 bind) pass through
	if (equal(arg, "1") || equal(arg, "5"))
	{
		client_print(id, print_chat, "[AIM] Humans defend as CT - the Ts are the knife horde.");
		// re-enters this hook as "jointeam 2", which falls through untouched
		engclient_cmd(id, "jointeam", "2");
		return PLUGIN_HANDLED;
	}
	return PLUGIN_CONTINUE;
}
