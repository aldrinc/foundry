let shell_active = false;

export function is_shell_active(): boolean {
    return shell_active;
}

export function set_shell_active(active: boolean): void {
    shell_active = active;
}

export function clear_shell_active(): void {
    shell_active = false;
}
