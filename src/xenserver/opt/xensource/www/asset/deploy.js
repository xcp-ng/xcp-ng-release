let call,
  vmRef,
  vmIp,
  host = window.location.host

function _handleUserError(error) {
  alert(
    typeof error === 'object' && !(error instanceof Error)
      ? JSON.stringify(error, null, 2)
      : (error && error.message) || error
  )
}

function setStep(previousStep, nextStep) {
  $(`#${previousStep}`).css({ display: 'none' })
  $(`#${nextStep}`).css({ display: 'block' })
}

function _jsonRpcCall(url, method, params) {
  console.log(`-> ${method}(${JSON.stringify(params)})`)
  return window
    .fetch(url, {
      body: JSON.stringify({
        id: 0,
        jsonrpc: '2.0',
        method,
        params
      }),
      method: 'POST',
      headers: new Headers({
        Accept: 'application/json',
        'Content-Type': 'application/json'
      })
    })
    .then(res => {
      if (!res.ok) {
        throw res.status
      }
      return res.json().then(json => {
        if (json.result !== undefined) {
          console.log(`<- ${JSON.stringify(json.result)}`)
          return json.result
        }
        console.error(`<x ${JSON.stringify(json.error)}`)
        throw json.error
      })
    })
}
function _call(method, params) {
  return _jsonRpcCall(`//${host}/jsonrpc`, method, params).catch(error => {
    if (error && error.message === 'HOST_IS_SLAVE') {
      console.log('Host is slave, changing host to master', error.data[0])
      host = error.data[0]
      return _call(method, params)
    }
    throw error
  })
}

function connect() {
  $('#connect fieldset').attr('disabled', true)
  _call('session.login_with_password', [
    'root',
    $('#pwd').val(),
    '2.3',
    'XOA deploy'
  ])
    .then(sessionRef => {
      call = (method, ...params) => _call(method, [sessionRef].concat(params))
    })
    .then(() =>
      Promise.all([
        call('SR.get_all_records'),
        call('pool.get_all_records'),
        call('network.get_all_records'),
        call('PIF.get_all_records')
      ])
    )
    .then(([srs, pools, networks, pifs]) => {
      setStep('connect', 'config')
      const selectSr = $('#srs')
      let sr
      Object.keys(srs).forEach(srRef => {
        sr = srs[srRef]
        if (sr.content_type !== 'iso' && sr.physical_size > 0) {
          selectSr.append(
            $('<option/>')
              .val(srRef)
              .text(
                `${sr.name_label} - ${Math.round(
                  (sr.physical_size - sr.physical_utilisation) /
                    Math.pow(1024, 3)
                )} GiB left`
              )
          )
        }
      })
      const { default_SR } = pools[Object.keys(pools)[0]]
      if (default_SR !== undefined) {
        selectSr.val(default_SR)
      }
      const selectNetwork = $('#networks')
      let network
      Object.keys(networks).forEach(networkRef => {
        network = networks[networkRef]
        selectNetwork.append(
          $('<option/>')
            .val(networkRef)
            .data('mtu', network.MTU)
            .text(network.name_label)
        )
      })
      const managementPif = Object.values(pifs).find(pif => pif.management)
      if (managementPif && managementPif.network !== undefined) {
        selectNetwork.val(managementPif.network)
      }
    })
    .catch(err => {
      $('#connect fieldset').attr('disabled', false)
      this._handleUserError(err)
    })
}

function deploy() {
  const status = text => $('#deploy').text(text)
  $('i.fa-spinner.fa-pulse').css({ display: 'inherit' })
  const srRef = $('#srs').val()
  status('Deploying XOA…')
  $('#accounts fieldset').attr('disabled', true)
  const updaterEmail = $('#updaterEmail').val()
  const updaterPwd = $('#updaterPwd').val()
  Promise.resolve()
    .then(() => {
      if (updaterEmail && updaterPwd) {
        return _jsonRpcCall('https://xen-orchestra.com/api', 'authenticate', {
          email: updaterEmail,
          password: updaterPwd
        })
      }
    })
    .then(() =>
      call(
        'VM.import',
        'http://xoa.io:8888/',
        srRef,
        false, // full_restore
        false // force
      )
    )
    .then(([_vmRef]) => {
      vmRef = _vmRef
      status('Configuring XOA…')
      const promises = []
      const ip = $('#ip').val()
      if (ip) {
        promises.push(
          call('VM.add_to_xenstore_data', vmRef, 'vm-data/ip', ip),
          call(
            'VM.add_to_xenstore_data',
            vmRef,
            'vm-data/netmask',
            $('#netmask').val() || '255.255.255.0'
          ),
          call(
            'VM.add_to_xenstore_data',
            vmRef,
            'vm-data/gateway',
            $('#gateway').val() || ''
          ),
          call(
            'VM.add_to_xenstore_data',
            vmRef,
            'vm-data/dns',
            $('#dns').val() || '8.8.8.8'
          )
        )
      }
      const email = $('#adminEmail').val()
      const password = $('#adminPwd').val()
      if (email && password) {
        promises.push(
          call(
            'VM.add_to_xenstore_data',
            vmRef,
            'vm-data/admin-account',
            JSON.stringify({ email, password })
          )
        )
      }
      if (updaterEmail && updaterPwd) {
        promises.push(
          call(
            'VM.add_to_xenstore_data',
            vmRef,
            'vm-data/xoa-updater-credentials',
            JSON.stringify({ email: updaterEmail, password: updaterPwd })
          )
        )
      }
      const xoaPwd = $('#xoaPwd').val()
      if (xoaPwd) {
        promises.push(
          call(
            'VM.add_to_xenstore_data',
            vmRef,
            'vm-data/system-account-xoa-password',
            xoaPwd
          )
        )
      }
      promises.push(
        call(
          'VM.add_to_xenstore_data',
          vmRef,
          'vm-data/xen-servers',
          JSON.stringify([{
            allowUnauthorized: true,
            host,
            password: $('#pwd').val(),
            username: 'root'
          }])
        )
      )

      const network = $('#networks').val()
      const MTU = $('#networks')
        .find(':selected')
        .data('mtu')
      promises.push(
        call('VM.get_VIFs', vmRef)
          .then(([vifRef]) => call('VIF.destroy', vifRef))
          .then(() => call('VM.get_allowed_VIF_devices', vmRef))
          .then(devices =>
            call('VIF.create', {
              device: devices[0],
              MAC: '',
              MTU,
              network,
              other_config: {},
              qos_algorithm_params: {},
              qos_algorithm_type: '',
              VM: vmRef
            })
          )
      )

      return Promise.all(promises)
    })
    .then(() => {
      status('Starting XOA…')
      return call(
        'VM.start',
        vmRef,
        false, // start_paused
        false // force
      )
    })
    .then(() => call('VM.get_guest_metrics', vmRef))
    .then(metricsRef => {
      status('Almost there…')
      let attempts = 120
      const waitForIp = () => {
        return call('VM_guest_metrics.get_networks', metricsRef).then(
          networks => {
            if (networks && networks['0/ip'] !== undefined) {
              return networks['0/ip']
            }
            if (attempts-- === 0) {
              throw 'XOA not responding'
            }
            return new Promise((resolve, reject) =>
              setTimeout(() => waitForIp().then(resolve, reject), 1e3)
            )
          }
        )
      }
      return waitForIp()
    })
    .then(ip => {
      vmIp = ip
      return Promise.all(
        [
          'admin-account',
          'dns',
          'gateway',
          'ip',
          'netmask',
          'xen-servers',
          'xoa-updater-credentials'
        ].map(key =>
          call('VM.remove_from_xenstore_data', vmRef, `vm-data/${key}`)
        )
      )
    })
    .then(() => {
      status('XOA is ready! Redirecting…')
      setTimeout(() => {
        window.location = `http://${$('#ip').val() || vmIp}`
      }, 3e3)
    })
    .catch(err => {
      $('#accounts fieldset').attr('disabled', false)
      $('i.fa-spinner.fa-pulse').css({ display: 'none' })
      status('Deploy')
      this._handleUserError(err)
    })
}
