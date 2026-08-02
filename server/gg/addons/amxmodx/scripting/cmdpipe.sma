// Frag Friday command pipe - remote console for a stack with no rcon.
//
// This Xash3D build answers no rcon/A2S queries and the container's stdin is
// closed (see docs/troubleshooting.md), so this plugin polls a compose-mounted
// file and feeds new commands to the server console. The mount is read-only:
// instead of consuming the file, a serial number on line 1 marks each write,
// and the plugin only executes when the serial changes. On (re)load it swallows
// the current serial without executing, so container restarts and map changes
// never replay the last command.
//
// Write side: scripts/rc.sh on the laptop (pnpm run rc "changelevel de_dust2"),
// which bumps the serial and replaces /opt/cs16/cmdpipe/cmd.txt atomically.
//
// File format:
//   <serial>
//   <console command>
//   <console command...>

#include <amxmodx>

#define PIPE_FILE "cmdpipe/cmd.txt"
#define POLL_INTERVAL 1.0

new g_lastSerial;

public plugin_init()
{
	register_plugin("Frag Friday Command Pipe", "0.1.0", "frag-friday");

	g_lastSerial = read_serial();
	set_task(POLL_INTERVAL, "task_poll", _, _, _, "b");
}

read_serial()
{
	new f = fopen(PIPE_FILE, "rt");
	if (!f)
		return 0;

	new line[16];
	fgets(f, line, charsmax(line));
	fclose(f);
	trim(line);
	return str_to_num(line);
}

public task_poll()
{
	new f = fopen(PIPE_FILE, "rt");
	if (!f)
		return;

	new line[192];
	if (!fgets(f, line, charsmax(line)))
	{
		fclose(f);
		return;
	}

	trim(line);
	new serial = str_to_num(line);
	if (serial <= 0 || serial == g_lastSerial)
	{
		fclose(f);
		return;
	}
	g_lastSerial = serial;

	new ran = 0;
	while (fgets(f, line, charsmax(line)))
	{
		trim(line);
		if (!line[0])
			continue;
		log_amx("cmdpipe #%d: %s", serial, line);
		server_cmd("%s", line);
		ran++;
	}
	fclose(f);

	if (ran)
		server_exec();
}
