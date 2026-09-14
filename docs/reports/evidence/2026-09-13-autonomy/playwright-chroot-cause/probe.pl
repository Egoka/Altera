# Фиксированный Linux arm64 control. Никаких modules, exec, shell или сетевых вызовов.
# --self-test проверяет только чистую логику с callbacks, без fork/syscall/procfs.
sub json_value {
    my ($value, $key) = @_;
    return 'null' unless defined $value;
    if (ref($value) eq 'HASH') {
        return '{' . join(',', map { '"' . $_ . '":' . json_value($value->{$_}, $_) } sort keys %$value) . '}';
    }
    if (ref($value) eq 'ARRAY') { return '[' . join(',', map { json_value($_, '') } @$value) . ']'; }
    if ($key =~ /^(return|errno|uid|gid|namespace_inode|chroot_attempted|map_ok|child_pid|reaped|synthetic)$/) {
        die "invalid_number\n" unless $value =~ /^-?[0-9]+$/;
        return 0 + $value;
    }
    die "unsafe_result_string\n" unless $value =~ /^[a-zA-Z0-9_: .-]*$/;
    return '"' . $value . '"';
}
sub child_flow {
    my ($ops) = @_;
    my $record = { phase => 'before_unshare', before => $ops->{snapshot}->(), chroot_attempted => 0 };
    my ($ret, $errno) = $ops->{unshare}->();
    if ($ret != 0) {
        $ops->{ready}->('F');
        return { %$record, phase => 'unshare_failed', return => $ret, errno => $errno };
    }
    $ops->{ready}->('U');
    unless ($ops->{mapped}->()) { return { %$record, phase => 'mapping_failed', map_ok => 0 }; }
    $record->{after} = $ops->{snapshot}->();
    unless ($record->{after}->{namespace_inode} != $record->{before}->{namespace_inode} &&
            $record->{after}->{uid} == 1000 && $record->{after}->{gid} == 1000 &&
            $record->{after}->{CapEff} =~ /^[a-fA-F0-9]+$/ &&
            (hex($record->{after}->{CapEff}) & (1 << 18))) {
        return { %$record, phase => 'namespace_or_capability_unverified', map_ok => 1 };
    }
    # После успешного chroot только возврат чисел, сериализация уже известных данных и write в pipe.
    ($ret, $errno) = $ops->{chroot}->();
    return { %$record, phase => 'chroot_result', map_ok => 1, chroot_attempted => 1,
             return => $ret, errno => $errno };
}
sub install_maps {
    my ($pid, $write) = @_;
    die "invalid_child\n" unless $pid =~ /^[1-9][0-9]*$/;
    for my $entry (['setgroups', "deny\n"], ['uid_map', "1000 1000 1\n"], ['gid_map', "1000 1000 1\n"]) {
        return 0 unless $write->('/proc/' . $pid . '/' . $entry->[0], $entry->[1]);
    }
    return 1;
}
sub reap_child {
    my ($pid, $terminate, $wait) = @_;
    die "invalid_child\n" unless $pid =~ /^[1-9][0-9]*$/;
    $terminate->($pid);
    return $wait->($pid) == $pid ? 1 : 0;
}
sub self_test {
    my %cases;
    for my $name ('success', 'eperm', 'other_errno', 'mapping_failure', 'unshare_failure') {
        my ($snapshots, $calls, @ready) = (0, 0);
        my $result = child_flow({
            snapshot => sub { $snapshots++; return { namespace_inode => $snapshots, uid => 1000, gid => 1000, CapEff => $snapshots == 1 ? '0000000000000000' : '0000000000040000' }; },
            unshare => sub { return $name eq 'unshare_failure' ? (-1, 1) : (0, 0); },
            ready => sub { push @ready, $_[0]; }, mapped => sub { return $name ne 'mapping_failure'; },
            chroot => sub { $calls++; return $name eq 'success' ? (0, 0) : (-1, $name eq 'eperm' ? 1 : 2); },
        });
        die "unexpected_chroot\n" if ($name =~ /failure/ && $calls);
        $cases{$name} = $result;
    }
    my (@writes, @killed, @waited);
    my $ok = install_maps(123, sub { push @writes, [@_]; return 1; });
    die "map_contract\n" unless $ok && @writes == 3 && $writes[1]->[1] eq "1000 1000 1\n";
    my $fail_calls = 0;
    die "map_failure\n" if install_maps(123, sub { $fail_calls++; return $fail_calls < 2; });
    die "continued_failed_map\n" unless $fail_calls == 2;
    my $reaped = reap_child(123, sub { push @killed, $_[0]; }, sub { push @waited, $_[0]; return $_[0]; });
    die "cleanup_contract\n" unless $reaped && @killed == 1 && @waited == 1 && $killed[0] == 123 && $waited[0] == 123;
    print json_value({ synthetic => 1, cases => \%cases, cleanup => { child_pid => 123, reaped => $reaped }, map_ok => $ok }, '') . "\n";
}
if (@ARGV == 1 && $ARGV[0] eq '--self-test') { self_test(); exit 0; }
die "fixed_invocation_required\n" if @ARGV;
die "linux_required\n" unless $^O eq 'linux';
die "uid_gid_required\n" unless $< == 1000 && $> == 1000 && $( =~ /^1000(?: |$)/ && $) =~ /^1000(?: |$)/;
open(my $elf, '<', '/proc/self/exe') or die "elf_unavailable\n";
binmode($elf); my $header = ''; read($elf, $header, 20) == 20 or die "elf_short\n"; close($elf);
die "arm64_required\n" unless substr($header, 0, 6) eq "\x7fELF\x02\x01" && unpack('v', substr($header, 18, 2)) == 183;
sub snapshot {
    my @ns = stat('/proc/self/ns/user'); die "namespace_unavailable\n" unless @ns;
    open(my $status, '<', '/proc/self/status') or die "status_unavailable\n";
    my ($gid) = split(/ /, $));
    my %record = (namespace_inode => $ns[1], uid => 0 + $<, gid => 0 + $gid);
    while (my $line = <$status>) {
        if ($line =~ /^(CapInh|CapPrm|CapEff|CapBnd|CapAmb|NoNewPrivs|Seccomp):\s*([0-9a-fA-F]+)\s*$/) { $record{$1} = $2; }
    }
    close($status); die "status_incomplete\n" unless keys(%record) == 10;
    return \%record;
}
pipe(my $ready_r, my $ready_w) or die "pipe_failed\n";
pipe(my $go_r, my $go_w) or die "pipe_failed\n";
pipe(my $result_r, my $result_w) or die "pipe_failed\n";
my $parent_before = snapshot();
die "outer_boundary_unverified\n" unless $parent_before->{CapEff} eq '0000000000000000' &&
    $parent_before->{CapBnd} eq '0000000000000000' && $parent_before->{NoNewPrivs} eq '1' && $parent_before->{Seccomp} eq '2';
my $pid = fork(); die "fork_failed\n" unless defined $pid;
if ($pid == 0) {
    close($ready_r); close($go_w); close($result_r);
    my $record;
    eval {
        $record = child_flow({ snapshot => \&snapshot,
            unshare => sub { $! = 0; my $ret = syscall(97, 0x10000000); my $err = 0 + $!; return ($ret, $ret == 0 ? 0 : $err); },
            ready => sub { syswrite($ready_w, $_[0], 1) == 1 or die "ready_failed\n"; },
            mapped => sub { my $go = ''; return sysread($go_r, $go, 1) == 1 && $go eq 'G'; },
            chroot => sub { my $literal = '/proc/self/fdinfo/'; $! = 0; my $ret = syscall(51, $literal); my $err = 0 + $!; return ($ret, $ret == 0 ? 0 : $err); },
        });
    };
    $record = { phase => 'probe_error', chroot_attempted => 0 } if $@;
    my $json = json_value($record, '') . "\n";
    die "result_bound\n" if length($json) > 4096;
    syswrite($result_w, $json, length($json));
    close($ready_w); close($go_r); close($result_w); exit 0;
}
close($ready_w); close($go_r); close($result_w);
my ($result, $error, $reaped) = ('', '', 0);
eval {
    local $SIG{ALRM} = sub { die "watchdog\n"; }; alarm(5);
    my $ready = ''; sysread($ready_r, $ready, 1) == 1 or die "no_ready\n";
    if ($ready eq 'U') {
        my $ok = install_maps($pid, sub {
            my ($path, $bytes) = @_;
            open(my $map, '>', $path) or return 0;
            my $written = syswrite($map, $bytes, length($bytes)); my $closed = close($map);
            return defined($written) && $written == length($bytes) && $closed;
        });
        my $go = $ok ? 'G' : 'F'; syswrite($go_w, $go, 1) == 1 or die "go_failed\n";
    }
    while (1) { my $bytes = ''; my $count = sysread($result_r, $bytes, 1024); die "read_failed\n" unless defined $count; last if $count == 0; $result .= $bytes; die "result_bound\n" if length($result) > 4096; }
    waitpid($pid, 0) == $pid or die "wait_failed\n"; $reaped = 1; alarm(0);
};
$error = $@; alarm(0);
unless ($reaped) { $reaped = reap_child($pid, sub { kill 9, $_[0]; }, sub { waitpid($_[0], 0) }); }
close($ready_r); close($go_w); close($result_r);
my $parent_after = snapshot();
die "parent_namespace_changed\n" unless $parent_before->{namespace_inode} == $parent_after->{namespace_inode};
if ($error || !$reaped || $result !~ /^\{[^\n]+\}\n$/) {
    print json_value({ phase => 'parent_control_failed', reaped => $reaped, chroot_attempted => 0 }, '') . "\n"; exit 78;
}
# Child JSON не переинтерпретируется; enclosing record содержит только отдельно измеренный parent state.
print '{"parent_before":' . json_value($parent_before, '') . ',"parent_after":' . json_value($parent_after, '') . ',"reaped":1,"child":' . substr($result, 0, -1) . "}\n";
exit 0;
